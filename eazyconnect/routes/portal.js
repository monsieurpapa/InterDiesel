const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../db');
const { activateVoucher } = require('../services/voucher');
const { getMikroTik } = require('../services/mikrotik');

function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
}

// GET /portal — captive portal page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/portal/index.html'));
});

// POST /portal/login — validate voucher and grant access
router.post('/login', async (req, res) => {
  const { code, mac, ip, url } = req.body;
  if (!code) return res.status(400).json({ error: 'Code requis' });

  const result = activateVoucher(code, mac, ip);
  if (!result.success) return res.status(400).json({ error: result.error });

  const settings = getSettings();
  let mikrotikOk = false;

  try {
    const mt = await getMikroTik(settings);
    if (!result.alreadyActive) {
      await mt.addHotspotUser(
        result.voucher.code,
        result.voucher.mikrotik_profile,
        mac || null
      );
    }
    mikrotikOk = true;
  } catch (_) {
    // Standalone mode — validation OK, no router enforcement
  }

  const host = settings.mikrotik_host || '192.168.88.1';
  const dst  = url || 'http://google.com';

  res.json({
    success: true,
    alreadyActive: result.alreadyActive || false,
    msLeft: result.msLeft,
    packageName: result.voucher.package_name,
    expiresAt: result.voucher.expires_at,
    mikrotikOk,
    // When MikroTik is reachable, send browser through its login to activate the session
    loginUrl: mikrotikOk
      ? `http://${host}/login?username=${encodeURIComponent(result.voucher.code)}&password=${encodeURIComponent(result.voucher.code)}&dst=${encodeURIComponent(dst)}`
      : null
  });
});

// GET /portal/status?code=XXXX
router.get('/status', (req, res) => {
  const code = (req.query.code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ error: 'Code requis' });

  const v = db.prepare(`
    SELECT v.*, p.name pkg_name FROM vouchers v
    JOIN packages p ON p.id=v.package_id WHERE v.code=?
  `).get(code);

  if (!v || v.status !== 'active') return res.json({ active: false });

  const now = new Date(), exp = new Date(v.expires_at);
  if (now >= exp) {
    db.prepare("UPDATE vouchers SET status='expired', ended_at=? WHERE id=?")
      .run(now.toISOString(), v.id);
    return res.json({ active: false });
  }

  res.json({ active: true, msLeft: exp - now, packageName: v.pkg_name, expiresAt: v.expires_at });
});

module.exports = router;
