const cron = require('node-cron');
const { expireOldVouchers } = require('./voucher');

function start() {
  // Check for expired vouchers every minute
  cron.schedule('* * * * *', () => {
    try {
      const n = expireOldVouchers();
      if (n > 0) console.log(`[scheduler] ${n} voucher(s) marqué(s) expiré(s)`);
    } catch (e) {
      console.error('[scheduler] Erreur:', e.message);
    }
  });
  console.log('[scheduler] Démarré — vérification chaque minute');
}

module.exports = { start };
