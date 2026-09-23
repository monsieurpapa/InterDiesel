import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db';
import { getRecord, putRecord } from './db';
import type { Device } from './sync';
import type { User } from '../shared/types';

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function setCredentials(db: DB, userId: string, username: string, password: string) {
  db.prepare(
    `INSERT INTO credentials(user_id, username, password_hash) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash`,
  ).run(userId, username.trim(), hashPassword(password));
  // Devices need to know the username to pre-fill owner forms; the password never leaves the server.
  const u = getRecord(db, 'user', userId);
  if (u && u.data.username !== username.trim()) putRecord(db, 'user', userId, null, { ...u.data, username: username.trim() }, u.clocks);
}

/** Checks a username/password. Returns the active user or null. */
export function login(db: DB, username: string, password: string): User | null {
  const row = db.prepare('SELECT user_id, password_hash FROM credentials WHERE username = ?').get(String(username ?? '').trim()) as any;
  if (!row) {
    verifyPassword(String(password ?? ''), 'scrypt$00$00'); // keep timing similar
    return null;
  }
  if (!verifyPassword(String(password ?? ''), row.password_hash)) return null;
  const user = getRecord(db, 'user', row.user_id)?.data as User | undefined;
  if (!user || !user.active) return null;
  return user;
}

export function createDevice(db: DB, name: string, scope: string | null, createdBy: string) {
  const id = `dev_${randomBytes(6).toString('hex')}`;
  const token = randomBytes(32).toString('base64url');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM devices').get() as any).n + 1;
  const code = n.toString(36).toUpperCase().padStart(2, '0');
  db.prepare('INSERT INTO devices(id, code, name, token_hash, scope, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(
    id,
    code,
    name.slice(0, 60),
    sha256(token),
    scope,
    createdBy,
    Date.now(),
  );
  return { id, code, token, scope };
}

export function deviceFromToken(db: DB, header: string | undefined): Device | null {
  if (!header?.startsWith('Bearer ')) return null;
  const row = db.prepare('SELECT id, code, scope, revoked FROM devices WHERE token_hash = ?').get(sha256(header.slice(7))) as any;
  if (!row || row.revoked) return null;
  db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), row.id);
  return { id: row.id, code: row.code, scope: row.scope };
}

/**
 * Limits failed logins per IP and per username (10 per 10 minutes). A successful
 * login only clears its own username counter, so one valid account cannot be used
 * to reset the counter while guessing another account's password.
 */
const failures = new Map<string, { n: number; until: number }>();
export function isBlocked(keys: string[], max = 10): boolean {
  const now = Date.now();
  return keys.some((k) => {
    const a = failures.get(k);
    if (!a) return false;
    if (a.until < now) {
      failures.delete(k);
      return false;
    }
    return a.n >= max;
  });
}
export function recordFailure(keys: string[], windowMs = 10 * 60_000) {
  const now = Date.now();
  for (const k of keys) {
    const a = failures.get(k);
    if (!a || a.until < now) failures.set(k, { n: 1, until: now + windowMs });
    else a.n++;
  }
}
export function clearFailures(key: string) {
  failures.delete(key);
}
