const db = require('../db');

// Alphabet sans caractères ambigus (0/O, 1/I/L, S/5)
const SAFE = 'ABCDEFGHJKMNPQRTUVWXYZ23456789';

function generateCode() {
  let a = '', b = '';
  for (let i = 0; i < 4; i++) {
    a += SAFE[Math.floor(Math.random() * SAFE.length)];
    b += SAFE[Math.floor(Math.random() * SAFE.length)];
  }
  return `${a}-${b}`;
}

function generateBatch(packageId, quantity, notes = '') {
  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND active=1').get(packageId);
  if (!pkg) throw new Error('Forfait introuvable');
  if (quantity < 1 || quantity > 500) throw new Error('Quantité invalide (1–500)');

  const batchId = Date.now().toString(36).toUpperCase();
  const now = new Date().toISOString();
  const checkCode = db.prepare('SELECT id FROM vouchers WHERE code=?');
  const insBatch = db.prepare(
    'INSERT INTO batches (id,package_id,quantity,notes,created_at) VALUES (?,?,?,?,?)'
  );
  const insVoucher = db.prepare(
    'INSERT INTO vouchers (code,batch_id,package_id,created_at) VALUES (?,?,?,?)'
  );

  const codes = [];
  db.transaction(() => {
    insBatch.run(batchId, packageId, quantity, notes, now);
    for (let i = 0; i < quantity; i++) {
      let code, tries = 0;
      do { code = generateCode(); tries++; } while (checkCode.get(code) && tries < 200);
      insVoucher.run(code, batchId, packageId, now);
      codes.push(code);
    }
  })();

  return { batchId, package: pkg, codes };
}

function activateVoucher(code, macAddress, ipAddress) {
  const clean = (code || '').toUpperCase().replace(/\s/g, '');

  const v = db.prepare(`
    SELECT v.*, p.duration_minutes, p.name AS package_name,
           p.mikrotik_profile, p.price_fc, p.color
    FROM vouchers v JOIN packages p ON p.id=v.package_id
    WHERE v.code=?
  `).get(clean);

  if (!v) return { success: false, error: 'Code invalide. Vérifiez le voucher.' };

  if (v.status === 'active') {
    const now = new Date(), exp = new Date(v.expires_at);
    if (now < exp) return { success: true, alreadyActive: true, voucher: v, msLeft: exp - now };
    db.prepare("UPDATE vouchers SET status='expired',ended_at=? WHERE id=?")
      .run(now.toISOString(), v.id);
    return { success: false, error: 'Ce voucher a expiré.' };
  }

  if (v.status !== 'unused') {
    const labels = { expired: 'expiré', cancelled: 'annulé' };
    return { success: false, error: `Voucher ${labels[v.status] || 'invalide'}.` };
  }

  const now = new Date();
  const expires = new Date(now.getTime() + v.duration_minutes * 60000);

  db.prepare(`
    UPDATE vouchers SET status='active', mac_address=?, ip_address=?,
    activated_at=?, expires_at=? WHERE id=?
  `).run(macAddress || null, ipAddress || null, now.toISOString(), expires.toISOString(), v.id);

  return { success: true, voucher: { ...v, expires_at: expires.toISOString() }, msLeft: expires - now };
}

function expireOldVouchers() {
  const now = new Date().toISOString();
  return db.prepare(
    "UPDATE vouchers SET status='expired', ended_at=? WHERE status='active' AND expires_at < ?"
  ).run(now, now).changes;
}

function cancelVoucher(id) {
  const v = db.prepare('SELECT * FROM vouchers WHERE id=?').get(id);
  if (!v) throw new Error('Voucher introuvable');
  if (v.status !== 'unused') throw new Error('Seuls les vouchers non utilisés peuvent être annulés');
  db.prepare("UPDATE vouchers SET status='cancelled' WHERE id=?").run(id);
}

module.exports = { generateBatch, activateVoucher, expireOldVouchers, cancelVoucher };
