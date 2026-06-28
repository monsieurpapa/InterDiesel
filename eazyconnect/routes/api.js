const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateBatch, cancelVoucher } = require('../services/voucher');
const { getMikroTik, resetConnection } = require('../services/mikrotik');

function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
}

function requireAdmin(req, res, next) {
  const expected = `Bearer ${process.env.ADMIN_PASSWORD || 'admin'}`;
  if (req.headers.authorization !== expected) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

// Verify password — returns token to store in browser
router.post('/auth', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'admin')) {
    res.json({ success: true, token: password });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

router.use(requireAdmin);

// Stats
router.get('/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const activeNow    = db.prepare("SELECT COUNT(*) c FROM vouchers WHERE status='active'").get().c;
  const todaySold    = db.prepare("SELECT COUNT(*) c FROM vouchers WHERE activated_at LIKE ? AND status IN ('active','expired')").get(`${today}%`).c;
  const todayRevFC   = db.prepare("SELECT COALESCE(SUM(p.price_fc),0) t FROM vouchers v JOIN packages p ON p.id=v.package_id WHERE v.activated_at LIKE ? AND v.status IN ('active','expired')").get(`${today}%`).t;
  const totalRevFC   = db.prepare("SELECT COALESCE(SUM(p.price_fc),0) t FROM vouchers v JOIN packages p ON p.id=v.package_id WHERE v.status IN ('active','expired')").get().t;
  const unusedStock  = db.prepare("SELECT COUNT(*) c FROM vouchers WHERE status='unused'").get().c;
  const totalBatches = db.prepare('SELECT COUNT(*) c FROM batches').get().c;
  res.json({ activeNow, todaySold, todayRevFC, totalRevFC, unusedStock, totalBatches });
});

// Packages
router.get('/packages', (req, res) => {
  res.json(db.prepare('SELECT * FROM packages WHERE active=1 ORDER BY duration_minutes').all());
});

// Generate batch
router.post('/vouchers/batch', (req, res) => {
  const { packageId, quantity, notes } = req.body;
  if (!packageId || !quantity) return res.status(400).json({ error: 'packageId et quantity requis' });
  try {
    const r = generateBatch(+packageId, +quantity, notes || '');
    res.json({ success: true, batchId: r.batchId, count: r.codes.length, package: r.package });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// List vouchers
router.get('/vouchers', (req, res) => {
  const { status, package: pkgId, search, page = 1 } = req.query;
  const limit = 50, offset = (+page - 1) * limit;
  const wheres = ['1=1']; const params = [];
  if (status) { wheres.push('v.status=?'); params.push(status); }
  if (pkgId)  { wheres.push('v.package_id=?'); params.push(+pkgId); }
  if (search) { wheres.push('v.code LIKE ?'); params.push(`%${search.toUpperCase()}%`); }
  const where = wheres.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM vouchers v WHERE ${where}`).get(...params).c;
  const vouchers = db.prepare(`
    SELECT v.*, p.name pkg_name, p.price_fc, p.color, p.duration_minutes
    FROM vouchers v JOIN packages p ON p.id=v.package_id
    WHERE ${where} ORDER BY v.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ vouchers, total, pages: Math.ceil(total / limit), page: +page });
});

// Get batch (for printing)
router.get('/batches/:id', (req, res) => {
  const batch = db.prepare(`
    SELECT b.*, p.name pkg_name, p.price_fc, p.duration_minutes, p.color
    FROM batches b JOIN packages p ON p.id=b.package_id WHERE b.id=?
  `).get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Lot introuvable' });
  const vouchers = db.prepare('SELECT * FROM vouchers WHERE batch_id=? ORDER BY id').all(req.params.id);
  res.json({ batch, vouchers });
});

// List recent batches
router.get('/batches', (req, res) => {
  const batches = db.prepare(`
    SELECT b.*, p.name pkg_name, p.price_fc, p.color,
      (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id=b.id AND v.status='unused') unused_count
    FROM batches b JOIN packages p ON p.id=b.package_id
    ORDER BY b.created_at DESC LIMIT 30
  `).all();
  res.json(batches);
});

// Cancel voucher
router.delete('/vouchers/:id', (req, res) => {
  try { cancelVoucher(+req.params.id); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Active sessions
router.get('/sessions', (req, res) => {
  const now = new Date().toISOString();
  const sessions = db.prepare(`
    SELECT v.id, v.code, v.mac_address, v.ip_address, v.activated_at, v.expires_at,
           p.name pkg_name, p.price_fc, p.color
    FROM vouchers v JOIN packages p ON p.id=v.package_id
    WHERE v.status='active' AND v.expires_at > ?
    ORDER BY v.expires_at ASC
  `).all(now).map(s => ({ ...s, msLeft: new Date(s.expires_at) - new Date() }));
  res.json(sessions);
});

// Force disconnect
router.delete('/sessions/:mac', async (req, res) => {
  const mac = req.params.mac;
  try { const mt = await getMikroTik(getSettings()); await mt.disconnectByMac(mac); } catch (_) {}
  db.prepare("UPDATE vouchers SET status='expired', ended_at=? WHERE mac_address=? AND status='active'")
    .run(new Date().toISOString(), mac);
  res.json({ success: true });
});

// Revenue report
router.get('/reports', (req, res) => {
  const daily = db.prepare(`
    SELECT DATE(v.activated_at) date, COUNT(*) count, SUM(p.price_fc) revenue_fc
    FROM vouchers v JOIN packages p ON p.id=v.package_id
    WHERE v.status IN ('active','expired') AND v.activated_at IS NOT NULL
    GROUP BY DATE(v.activated_at) ORDER BY date DESC LIMIT 30
  `).all();
  const byPackage = db.prepare(`
    SELECT p.name, p.color, p.price_fc, p.duration_minutes,
           COUNT(v.id) count, COALESCE(SUM(p.price_fc),0) revenue_fc
    FROM packages p LEFT JOIN vouchers v ON v.package_id=p.id AND v.status IN ('active','expired')
    GROUP BY p.id ORDER BY revenue_fc DESC
  `).all();
  res.json({ daily, byPackage });
});

// Settings
router.get('/settings', (req, res) => {
  const s = getSettings();
  delete s.mikrotik_password;
  res.json(s);
});

router.put('/settings', (req, res) => {
  const allowed = ['mikrotik_host','mikrotik_port','mikrotik_user','mikrotik_password',
                   'server_ip','hotspot_name','wifi_name'];
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) upsert.run(k, String(v));
  }
  resetConnection();
  res.json({ success: true });
});

// MikroTik status
router.get('/mikrotik/status', async (req, res) => {
  try {
    const mt = await getMikroTik(getSettings());
    const sessions = await mt.getActiveSessions();
    res.json({ connected: true, activeSessions: sessions.length });
  } catch (e) { res.json({ connected: false, error: e.message }); }
});

// Setup MikroTik hotspot profiles
router.post('/mikrotik/setup-profiles', async (req, res) => {
  try {
    const mt = await getMikroTik(getSettings());
    await mt.setupProfiles();
    res.json({ success: true, message: '5 profils hotspot créés sur MikroTik' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
