require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

async function main() {
  // Initialize database first (sql.js requires async init)
  const db = require('./db');
  await db.initDatabase();

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(path.join(__dirname, 'public')));

  // Pages
  app.get('/',        (_, res) => res.sendFile(path.join(__dirname, 'public/landing/index.html')));
  app.get('/admin',   (_, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
  app.get('/print',   (_, res) => res.sendFile(path.join(__dirname, 'public/print/index.html')));
  app.get('/print/:batchId', (_, res) => res.sendFile(path.join(__dirname, 'public/print/index.html')));

  // API routes (required after DB init so they can import db safely)
  app.use('/portal', require('./routes/portal'));
  app.use('/api',    require('./routes/api'));

  app.use((_, res) => res.status(404).json({ error: 'Route introuvable' }));

  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║       EAZY KONNECT — Serveur démarré     ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Landing  → http://localhost:${PORT}       ║`);
    console.log(`║  Admin    → http://localhost:${PORT}/admin  ║`);
    console.log(`║  Portail  → http://localhost:${PORT}/portal ║`);
    console.log('╚══════════════════════════════════════════╝\n');
  });

  require('./services/scheduler').start();
}

main().catch(err => {
  console.error('[FATAL] Échec du démarrage:', err.message);
  process.exit(1);
});
