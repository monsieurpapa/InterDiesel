import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  // FULL: a transaction confirmed to a phone survives a power cut on the server too.
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      kind   TEXT NOT NULL,
      id     TEXT NOT NULL,
      scope  TEXT,            -- NULL = visible to every device, else a store id
      seq    INTEGER NOT NULL,
      data   TEXT NOT NULL,   -- JSON
      clocks TEXT,            -- JSON field->HLC, mutable records only
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
    CREATE INDEX IF NOT EXISTS records_scope_seq ON records(scope, seq);

    CREATE TABLE IF NOT EXISTS oplog (
      op_id       TEXT PRIMARY KEY,
      device_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL,
      error       TEXT,
      received_at INTEGER NOT NULL,
      body        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rejections (
      id        INTEGER PRIMARY KEY,
      op_id     TEXT,
      device_id TEXT,
      kind      TEXT,
      error     TEXT,
      at        INTEGER,
      body      TEXT
    );

    -- epoch changes when a backup is restored: devices then re-send their own
    -- documents and download everything again, so nothing made after the backup is lost.
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta(key, value) VALUES ('epoch', lower(hex(randomblob(8))));

    CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT OR IGNORE INTO counters(name, value) VALUES ('seq', 0);

    CREATE TABLE IF NOT EXISTS credentials (
      user_id       TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id          TEXT PRIMARY KEY,
      code        TEXT NOT NULL,
      name        TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      scope       TEXT,          -- NULL = all stores (owner device)
      created_by  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      last_seen   INTEGER,
      revoked     INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

export function getEpoch(db: DB): string {
  return (db.prepare("SELECT value FROM meta WHERE key = 'epoch'").get() as { value: string }).value;
}

export function newEpoch(db: DB) {
  db.prepare("UPDATE meta SET value = lower(hex(randomblob(8))) WHERE key = 'epoch'").run();
}

export function nextSeq(db: DB): number {
  const row = db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'seq' RETURNING value").get() as { value: number };
  return row.value;
}

export interface Row {
  kind: string;
  id: string;
  scope: string | null;
  seq: number;
  data: any;
  clocks: Record<string, string> | null;
}

export function getRecord(db: DB, kind: string, id: string): Row | null {
  const r = db.prepare('SELECT * FROM records WHERE kind = ? AND id = ?').get(kind, id) as any;
  if (!r) return null;
  return { ...r, data: JSON.parse(r.data), clocks: r.clocks ? JSON.parse(r.clocks) : null };
}

/** Insert or replace a record, giving it a new sequence number so devices pull it. */
export function putRecord(db: DB, kind: string, id: string, scope: string | null, data: unknown, clocks?: Record<string, string> | null) {
  const seq = nextSeq(db);
  db.prepare(
    `INSERT INTO records(kind, id, scope, seq, data, clocks) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET scope = excluded.scope, seq = excluded.seq, data = excluded.data, clocks = excluded.clocks`,
  ).run(kind, id, scope, seq, JSON.stringify(data), clocks ? JSON.stringify(clocks) : null);
  return seq;
}

/** Insert only if absent. Returns true when the row is new. */
export function insertRecord(db: DB, kind: string, id: string, scope: string | null, data: unknown): boolean {
  const seq = nextSeq(db);
  const r = db
    .prepare('INSERT OR IGNORE INTO records(kind, id, scope, seq, data, clocks) VALUES (?, ?, ?, ?, ?, NULL)')
    .run(kind, id, scope, seq, JSON.stringify(data));
  return r.changes === 1;
}

export function listKind(db: DB, kind: string): any[] {
  return (db.prepare('SELECT data FROM records WHERE kind = ?').all(kind) as any[]).map((r) => JSON.parse(r.data));
}
