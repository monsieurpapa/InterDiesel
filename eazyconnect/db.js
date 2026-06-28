/**
 * SQLite wrapper using sql.js (pure WebAssembly — no native compilation).
 * Provides a synchronous better-sqlite3-compatible API after async init.
 *
 * Usage:
 *   await require('./db').initDatabase();   // once at startup
 *   const db = require('./db');             // then use normally
 *   db.prepare('SELECT * FROM packages').all();
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'eazyconnect.db');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db = null;

class DbWrapper {
  constructor(sqlDb) {
    this._d = sqlDb;
    this._tx = false;  // inside transaction — defer disk save
  }

  pragma(stmt) {
    this._d.run(`PRAGMA ${stmt}`);
    return this;
  }

  exec(sql) {
    this._d.exec(sql);
    this._flush();
    return this;
  }

  prepare(sql) {
    const w = this;
    return {
      /** Returns first matching row or undefined */
      get(...args) {
        const p = flatten(args);
        const stmt = w._d.prepare(sql);
        try {
          if (p.length) stmt.bind(p);
          return stmt.step() ? stmt.getAsObject() : undefined;
        } finally { stmt.free(); }
      },
      /** Returns all matching rows */
      all(...args) {
        const p = flatten(args);
        const stmt = w._d.prepare(sql);
        const rows = [];
        try {
          if (p.length) stmt.bind(p);
          while (stmt.step()) rows.push(stmt.getAsObject());
        } finally { stmt.free(); }
        return rows;
      },
      /** Executes DML, returns { changes, lastInsertRowid } */
      run(...args) {
        const p = flatten(args);
        w._d.run(sql, p.length ? p : undefined);
        const changes = w._d.getRowsModified();
        const lastInsertRowid = w._d.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
        w._flush();
        return { changes, lastInsertRowid };
      }
    };
  }

  /** Wraps fn in a BEGIN/COMMIT transaction, saves to disk once at the end */
  transaction(fn) {
    const w = this;
    return function() {
      w._d.run('BEGIN');
      w._tx = true;
      try {
        const result = fn.apply(this, arguments);
        w._d.run('COMMIT');
        w._tx = false;
        w._flush();
        return result;
      } catch(e) {
        try { w._d.run('ROLLBACK'); } catch(_) {}
        w._tx = false;
        throw e;
      }
    };
  }

  _flush() {
    if (this._tx) return;
    fs.writeFileSync(DB_PATH, Buffer.from(this._d.export()));
  }
}

function flatten(args) {
  // Spread args may contain a single array or individual values
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args.flat(1);
}

// ─── Schema ───────────────────────────────────────────────────────────────────
function setupSchema(db) {
  db._d.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      duration_minutes INTEGER NOT NULL,
      price_fc INTEGER NOT NULL,
      speed_down_mbps REAL DEFAULT 2.0,
      speed_up_mbps REAL DEFAULT 1.0,
      mikrotik_profile TEXT NOT NULL,
      color TEXT DEFAULT '#0066FF',
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      package_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      notes TEXT DEFAULT '',
      printed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      batch_id TEXT NOT NULL,
      package_id INTEGER NOT NULL,
      status TEXT DEFAULT 'unused',
      mac_address TEXT,
      ip_address TEXT,
      activated_at TEXT,
      expires_at TEXT,
      ended_at TEXT,
      bytes_in INTEGER DEFAULT 0,
      bytes_out INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  db._flush();
}

// ─── Seed data ────────────────────────────────────────────────────────────────
function seedData(db) {
  if ((db.prepare('SELECT COUNT(*) c FROM packages').get()?.c ?? 0) > 0) return;

  const ins = db.prepare(
    'INSERT INTO packages (name,slug,duration_minutes,price_fc,speed_down_mbps,speed_up_mbps,mikrotik_profile,color) VALUES (?,?,?,?,?,?,?,?)'
  );
  db.transaction(() => {
    ins.run('Express 1h',     'express',    60,    200,    2.0,  1.0, 'ek-1h',  '#FF6B35');
    ins.run('Standard 3h',   'standard',   180,   500,    3.0,  1.5, 'ek-3h',  '#00D4FF');
    ins.run('Journée 12h',   'journee',    720,   1000,   5.0,  2.0, 'ek-12h', '#10B981');
    ins.run('Quotidien 24h', 'quotidien',  1440,  2000,   5.0,  2.0, 'ek-24h', '#6366F1');
    ins.run('Hebdo 7 jours', 'hebdo',      10080, 10000,  10.0, 5.0, 'ek-7d',  '#F59E0B');
  })();

  const ups = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  const defaults = [
    ['mikrotik_host', '192.168.88.1'], ['mikrotik_port', '8728'],
    ['mikrotik_user', 'admin'],        ['mikrotik_password', ''],
    ['server_ip', '192.168.88.10'],    ['hotspot_name', 'EAZY KONNECT'],
    ['wifi_name', 'EAZY-KONNECT'],
  ];
  db.transaction(() => { for (const [k,v] of defaults) ups.run(k, v); })();
}

// ─── Public init ──────────────────────────────────────────────────────────────
async function initDatabase() {
  const SQL = await initSqlJs();
  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    sqlDb = new SQL.Database();
  }
  _db = new DbWrapper(sqlDb);
  setupSchema(_db);
  seedData(_db);
  console.log('[db] Base de données prête →', DB_PATH);
  return _db;
}

// ─── Proxy exports ────────────────────────────────────────────────────────────
// All code does `const db = require('./db')` then uses db.prepare() etc.
// The proxy transparently delegates to _db after initDatabase() is called.
const dbProxy = new Proxy({ initDatabase }, {
  get(target, prop) {
    if (prop === 'initDatabase') return target.initDatabase;
    if (!_db) throw new Error(`[db] Not ready — call await db.initDatabase() first (accessed: ${String(prop)})`);
    const v = _db[prop];
    return typeof v === 'function' ? v.bind(_db) : v;
  }
});

module.exports = dbProxy;
