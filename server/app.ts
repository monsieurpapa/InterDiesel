import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import { existsSync, mkdirSync, createReadStream, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { DB } from './db';
import { listKind } from './db';
import { createDevice, deviceFromToken, login, setCredentials, isBlocked, recordFailure, clearFailures } from './auth';
import { pull, pushOps } from './sync';
import type { Op, Store, User } from '../shared/types';

export interface AppOptions {
  db: DB;
  clientDir?: string; // built PWA to serve
  logger?: boolean;
}

export function buildApp({ db, clientDir, logger = false }: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 8 * 1024 * 1024, trustProxy: true });

  // gzip/brotli: sync payloads are JSON and shrink 5-10x, which matters on paid mobile data.
  app.register(fastifyCompress, { threshold: 1024 });

  app.get('/api/health', async () => ({ ok: true, time: Date.now() }));

  const checkLogin = (req: any, reply: any): User | null => {
    const { username: rawUser } = (req.body ?? {}) as any;
    const userKey = `user:${String(rawUser ?? '').trim().toLowerCase()}`;
    const keys = [`ip:${req.ip}`, userKey];
    if (isBlocked(keys)) {
      reply.code(429).send({ error: 'too_many_attempts' });
      return null;
    }
    const { username, password } = (req.body ?? {}) as any;
    const user = login(db, username, password);
    if (!user || (user.role !== 'owner' && user.role !== 'manager')) {
      recordFailure(keys);
      reply.code(401).send({ error: 'bad_credentials' });
      return null;
    }
    clearFailures(userKey);
    return user;
  };

  const storesFor = (user: User): Store[] => {
    const stores = listKind(db, 'store').filter((s: Store) => s.active);
    return user.role === 'owner' ? stores : stores.filter((s: Store) => s.id === user.storeId);
  };

  // Step 1 of connecting a device: check the manager/owner password, list the stores they may pick.
  app.post('/api/enroll/options', async (req, reply) => {
    const user = checkLogin(req, reply);
    if (!user) return;
    return { user: { id: user.id, name: user.name, role: user.role }, stores: storesFor(user), allStores: user.role === 'owner' };
  });

  // Step 2: create the device and return its secret token (shown once).
  app.post('/api/enroll', async (req, reply) => {
    const user = checkLogin(req, reply);
    if (!user) return;
    const { storeId, deviceName } = (req.body ?? {}) as any;
    const scope: string | null = storeId ?? null;
    if (scope === null && user.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
    if (scope !== null && !storesFor(user).some((s) => s.id === scope)) return reply.code(403).send({ error: 'forbidden' });
    const dev = createDevice(db, String(deviceName || 'Appareil'), scope, user.id);
    return { deviceId: dev.id, deviceCode: dev.code, token: dev.token, storeId: scope };
  });

  const auth = (req: any, reply: any) => {
    const dev = deviceFromToken(db, req.headers.authorization);
    if (!dev) {
      reply.code(401).send({ error: 'device_not_enrolled' });
      return null;
    }
    return dev;
  };

  app.post('/api/sync/push', async (req, reply) => {
    const dev = auth(req, reply);
    if (!dev) return;
    const ops = (req.body as any)?.ops;
    if (!Array.isArray(ops) || ops.length > 500) return reply.code(400).send({ error: 'bad_request' });
    return { results: pushOps(db, dev, ops as Op[]), serverTime: Date.now() };
  });

  app.get('/api/sync/pull', async (req, reply) => {
    const dev = auth(req, reply);
    if (!dev) return;
    const since = Math.max(0, Number((req.query as any).since) || 0);
    return pull(db, dev, since);
  });

  // ---- Owner-only online actions (need the owner's password each time) ----
  const ownerOnly = (req: any, reply: any): User | null => {
    const user = checkLogin(req, reply);
    if (!user) return null;
    if (user.role !== 'owner') {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return user;
  };

  app.post('/api/admin/credentials', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const { userId, newUsername, newPassword } = (req.body ?? {}) as any;
    const target = listKind(db, 'user').find((u: User) => u.id === userId);
    if (!target || target.role === 'seller') return reply.code(400).send({ error: 'bad_user' });
    if (typeof newUsername !== 'string' || newUsername.trim().length < 3) return reply.code(400).send({ error: 'bad_username' });
    if (typeof newPassword !== 'string' || newPassword.length < 8) return reply.code(400).send({ error: 'weak_password' });
    try {
      setCredentials(db, userId, newUsername, newPassword);
    } catch {
      return reply.code(409).send({ error: 'username_taken' });
    }
    return { ok: true };
  });

  app.post('/api/admin/devices', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    return db.prepare('SELECT id, code, name, scope, created_at, last_seen, revoked FROM devices ORDER BY created_at').all();
  });

  app.post('/api/admin/devices/revoke', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const { deviceId } = (req.body ?? {}) as any;
    db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(String(deviceId));
    return { ok: true };
  });

  app.post('/api/admin/backup', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const file = join(tmpdir(), `interdiesel-backup-${Date.now()}.sqlite`);
    await db.backup(file);
    const day = new Date().toISOString().slice(0, 10);
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="interdiesel-${day}.sqlite"`);
    const stream = createReadStream(file);
    stream.on('close', () => {
      try {
        unlinkSync(file);
      } catch {}
    });
    return reply.send(stream);
  });

  if (clientDir && existsSync(clientDir)) {
    app.register(fastifyStatic, {
      root: resolve(clientDir),
      setHeaders(res, path) {
        // The service worker and the page must never be cached by the browser, only by the SW itself.
        if (path.endsWith('sw.js') || path.endsWith('index.html') || path.endsWith('.webmanifest')) {
          res.header('cache-control', 'no-cache');
        } else if (path.includes('/assets/')) {
          res.header('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
