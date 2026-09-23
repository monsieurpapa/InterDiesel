// Command line tasks for the person running the server.
//   node dist/cli.mjs init       -> first start with an empty catalog (asks for the owner account)
//   node dist/cli.mjs demo       -> first start with the Bukavu demo data
//   node dist/cli.mjs backup     -> copy the database to data/backups/
//   node dist/cli.mjs restore <file>
//   node dist/cli.mjs password <username>   -> reset a manager/owner password
import { createInterface } from 'node:readline/promises';
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { openDb, newEpoch } from './db';
import { ensureDir } from './app';
import { bootstrap, seedDemo } from './seed';
import { setCredentials } from './auth';
import { validPin } from '../shared/pin';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR ?? resolve(here, '../data'));
const dbFile = resolve(dataDir, 'interdiesel.sqlite');
const backupDir = resolve(dataDir, 'backups');
ensureDir(dataDir);

const [cmd, arg] = process.argv.slice(2);

async function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}

async function main() {
  switch (cmd) {
    case 'demo': {
      const db = openDb(dbFile);
      const r = await seedDemo(db);
      console.log(`Données de démonstration créées: ${r.products} articles, ${r.sales} ventes.`);
      console.log('Connexion propriétaire: proprietaire / interdiesel2026 (PIN 1111)');
      console.log('Gérants: ibanda/ibanda2026, kadutu/kadutu2026, bagira/bagira2026. Vendeurs: PIN 1234 ou 5678.');
      break;
    }
    case 'init': {
      const db = openDb(dbFile);
      const ownerName = await ask('Nom du propriétaire: ');
      const ownerUsername = await ask("Nom d'utilisateur (ex: proprietaire): ");
      const ownerPassword = await ask('Mot de passe (8 caractères minimum): ');
      if (ownerPassword.length < 8) throw new Error('Mot de passe trop court.');
      const ownerPin = await ask('Code PIN (4 à 6 chiffres): ');
      if (!validPin(ownerPin)) throw new Error('PIN invalide.');
      const rate = Number(await ask('Taux du jour, FC pour 1 USD (ex: 2300): '));
      await bootstrap(db, { ownerName, ownerUsername, ownerPassword, ownerPin, rate: rate > 0 ? rate : 2300 });
      console.log('Prêt. Les 3 magasins ont été créés; renommez-les depuis l’application (Menu > Magasins).');
      break;
    }
    case 'backup': {
      ensureDir(backupDir);
      const db = new Database(dbFile, { readonly: true });
      const file = resolve(backupDir, `interdiesel-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.sqlite`);
      await db.backup(file);
      db.close();
      // Keep the 30 most recent backups.
      const all = readdirSync(backupDir)
        .filter((f) => f.endsWith('.sqlite'))
        .map((f) => resolve(backupDir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      for (const old of all.slice(30)) unlinkSync(old);
      console.log(`Sauvegarde: ${file}`);
      break;
    }
    case 'restore': {
      if (!arg || !existsSync(arg)) throw new Error('Indiquez le fichier de sauvegarde à restaurer.');
      const check = new Database(arg, { readonly: true });
      const ok = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'records'").get() as any;
      check.close();
      if (!ok.n) throw new Error("Ce fichier n'est pas une sauvegarde Inter-Diesel.");
      if (existsSync(dbFile)) {
        ensureDir(backupDir);
        const safety = resolve(backupDir, `avant-restauration-${Date.now()}.sqlite`);
        copyFileSync(dbFile, safety);
        console.log(`Base actuelle mise de côté: ${basename(safety)}`);
      }
      // Keep today's devices and logins: devices connected after the backup must keep working.
      let devices: any[] = [];
      let creds: any[] = [];
      if (existsSync(dbFile)) {
        const cur = new Database(dbFile, { readonly: true });
        devices = cur.prepare('SELECT * FROM devices').all();
        creds = cur.prepare('SELECT * FROM credentials').all();
        cur.close();
      }
      for (const ext of ['-wal', '-shm']) if (existsSync(dbFile + ext)) unlinkSync(dbFile + ext);
      copyFileSync(arg, dbFile);
      // New epoch: every device re-sends what it made after this backup, then downloads again.
      const restored = openDb(dbFile);
      restored.transaction(() => {
        for (const d of devices)
          restored
            .prepare('INSERT OR REPLACE INTO devices(id, code, name, token_hash, scope, created_by, created_at, last_seen, revoked) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(d.id, d.code, d.name, d.token_hash, d.scope, d.created_by, d.created_at, d.last_seen, d.revoked);
        for (const c of creds)
          restored.prepare('INSERT OR REPLACE INTO credentials(user_id, username, password_hash) VALUES (?,?,?)').run(c.user_id, c.username, c.password_hash);
        newEpoch(restored);
      })();
      restored.close();
      console.log('Restauration terminée. Redémarrez le serveur. Les appareils renverront automatiquement leurs ventes faites depuis la sauvegarde.');
      break;
    }
    case 'password': {
      if (!arg) throw new Error("Indiquez le nom d'utilisateur.");
      const db = openDb(dbFile);
      const row = db.prepare('SELECT user_id FROM credentials WHERE username = ?').get(arg) as any;
      if (!row) throw new Error('Utilisateur inconnu.');
      const pw = await ask('Nouveau mot de passe (8 caractères minimum): ');
      if (pw.length < 8) throw new Error('Mot de passe trop court.');
      setCredentials(db, row.user_id, arg, pw);
      console.log('Mot de passe changé.');
      break;
    }
    default:
      console.log('Commandes: init | demo | backup | restore <fichier> | password <utilisateur>');
  }
}

main().catch((e) => {
  console.error('Erreur:', e.message);
  process.exit(1);
});
