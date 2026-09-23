import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { getRecord, openDb } from './db';
import { buildApp, ensureDir } from './app';
import { startDailyJobs } from './notify/jobs';
import { bootstrap, seedDemo } from './seed';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR ?? resolve(here, '../data'));
ensureDir(dataDir);
const db = openDb(resolve(dataDir, 'interdiesel.sqlite'));

// First start on a hosting service without a terminal: create the owner (or the demo)
// from environment settings. Does nothing once the database has an owner.
async function firstStart() {
  if (getRecord(db, 'user', 'u_owner')) return;
  if (process.env.SEED_DEMO === '1') {
    await seedDemo(db);
    console.log('Données de démonstration créées.');
  } else if (process.env.OWNER_USERNAME && process.env.OWNER_PASSWORD && process.env.OWNER_PIN) {
    await bootstrap(db, {
      ownerName: process.env.OWNER_NAME || 'Propriétaire',
      ownerUsername: process.env.OWNER_USERNAME,
      ownerPassword: process.env.OWNER_PASSWORD,
      ownerPin: process.env.OWNER_PIN,
      rate: Number(process.env.RATE) || 2300,
    });
    console.log(`Compte propriétaire créé: ${process.env.OWNER_USERNAME}`);
  }
}

// Daily copy of the database in DATA_DIR/backups (keeps 14), for hosts without a backup container.
function startBackups() {
  if (process.env.AUTO_BACKUP !== '1') return;
  const dir = resolve(dataDir, 'backups');
  const run = async () => {
    try {
      ensureDir(dir);
      await db.backup(resolve(dir, `interdiesel-${new Date().toISOString().slice(0, 10)}.sqlite`));
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sqlite'))
        .map((f) => resolve(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      for (const old of files.slice(14)) unlinkSync(old);
    } catch (e) {
      console.error('backup failed', e);
    }
  };
  run();
  setInterval(run, 24 * 3_600_000).unref();
}

const clientDir = process.env.CLIENT_DIR ?? resolve(here, 'client');
const app = buildApp({ db, clientDir, logger: process.env.NODE_ENV === 'production' });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

firstStart()
  .then(() => app.listen({ port, host }))
  .then(() => {
    console.log(`Inter-Diesel en marche sur http://localhost:${port}  (données: ${dataDir})`);
    startDailyJobs(db);
    startBackups();
  });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
