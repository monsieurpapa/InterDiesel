import 'fake-indexeddb/auto';
import { openDb } from '../server/db';
import { buildApp } from '../server/app';
import { bootstrap } from '../server/seed';
import { pushOps } from '../server/sync';
import { LocalDB } from '../src/core/db';
import { Engine } from '../src/core/engine';
import { HLC } from '../shared/hlc';
import { hashPin } from '../shared/pin';
import type { Op } from '../shared/types';

let dbCounter = 0;

export async function makeServer() {
  const db = openDb(':memory:');
  const { ownerId, stores } = await bootstrap(db, {
    ownerName: 'Owner',
    ownerUsername: 'owner',
    ownerPassword: 'owner-password',
    ownerPin: '1111',
  });
  const app = buildApp({ db });
  await app.ready();
  const clock = new HLC('test');
  const admin = (ops: Op[]) => {
    const r = pushOps(db, { id: 'dev_seed', code: 'S0', scope: null }, ops);
    const bad = r.filter((x) => x.status === 'rejected');
    if (bad.length) throw new Error(JSON.stringify(bad));
    return r;
  };
  let n = 0;
  const patch = (kind: string, id: string, fields: Record<string, unknown>, userId = ownerId): Op => ({
    type: 'patch',
    opId: `t_${++n}`,
    kind: kind as any,
    id,
    userId,
    hlc: clock.tick(),
    fields,
  });
  const doc = (kind: string, data: Record<string, any>, userId = ownerId): Op => ({
    type: 'doc',
    opId: data.id,
    kind: kind as any,
    userId,
    hlc: clock.tick(),
    data: { deviceId: 'dev_seed', userId, at: Date.now(), ...data },
  });

  // users: a manager and a seller in each of the first two stores
  const [A, B] = stores;
  admin([
    patch('user', 'u_mA', { name: 'Manager A', role: 'manager', storeId: A.id, pinHash: await hashPin('2222', 'u_mA'), phone: '', active: true }),
    patch('user', 'u_sA', { name: 'Seller A', role: 'seller', storeId: A.id, pinHash: await hashPin('1234', 'u_sA'), phone: '', active: true }),
    patch('user', 'u_mB', { name: 'Manager B', role: 'manager', storeId: B.id, pinHash: await hashPin('3333', 'u_mB'), phone: '', active: true }),
    patch('user', 'u_sB', { name: 'Seller B', role: 'seller', storeId: B.id, pinHash: await hashPin('1234', 'u_sB'), phone: '', active: true }),
    patch('product', 'p1', { ref: 'NGK-D8EA', name: 'Bougie', category: 'Électricité', fits: [], costUSD: 1, priceUSD: 2.5, priceCDF: null, active: true, brand: 'NGK', barcode: '', unit: 'pièce' }),
    patch('product', 'p2', { ref: 'BX-KIT', name: 'Kit chaîne', category: 'Transmission', fits: [], costUSD: 9, priceUSD: 15, priceCDF: null, active: true, brand: 'Bajaj', barcode: '', unit: 'pièce' }),
    patch('customer', 'c1', { name: 'Garage Umoja', phone: '+243990000000', note: '', creditLimitUSD: 500, active: true }),
  ]);
  const { setCredentials } = await import('../server/auth');
  setCredentials(db, 'u_mA', 'managera', 'manager-a-pass');
  setCredentials(db, 'u_mB', 'managerb', 'manager-b-pass');

  /** fetch() that goes straight into the Fastify app, with a switch to simulate no network. */
  const makeFetch = (net: { online: boolean }) =>
    (async (input: any, init?: any) => {
      if (!net.online) throw new TypeError('Failed to fetch');
      const url = String(input);
      const res = await app.inject({ method: init?.method ?? 'GET', url, headers: init?.headers, payload: init?.body });
      return { status: res.statusCode, ok: res.statusCode < 400, json: async () => res.json() } as any;
    }) as typeof fetch;

  async function enroll(username: string, password: string, storeId: string | null) {
    const res = await app.inject({ method: 'POST', url: '/api/enroll', payload: { username, password, storeId, deviceName: 'test' } });
    if (res.statusCode !== 200) throw new Error(res.body);
    return res.json() as { deviceId: string; deviceCode: string; token: string; storeId: string | null };
  }

  async function device(username: string, password: string, storeId: string | null, clock?: () => number) {
    const net = { online: true };
    const e = new Engine(new LocalDB(`test-${++dbCounter}`), makeFetch(net), () => net.online, clock);
    await e.init();
    const d = await enroll(username, password, storeId);
    await e.setDevice({ ...d, serverUrl: '' });
    await e.sync();
    return { engine: e, net };
  }

  return { db, app, ownerId, stores, A, B, admin, patch, doc, device, enroll };
}

/** Stock as the device shows it: server level + local pending movements. */
export async function localStock(e: Engine, storeId: string, productId: string): Promise<number> {
  const lvl = (await e.db.stock.get(`${storeId}:${productId}`))?.qty ?? 0;
  const pend = await e.db.movement.where('[storeId+productId]').equals([storeId, productId]).filter((m) => m.pending === 1).toArray();
  return lvl + pend.reduce((a, m) => a + m.qty, 0);
}

export function saleData(storeCode: string, no: number, productId: string, qty: number, price: number, opts: { credit?: boolean; customerId?: string } = {}) {
  const total = Math.round(qty * price * 100) / 100;
  return {
    no: `${storeCode}-T-${no}`,
    customerId: opts.customerId ?? null,
    rate: 2300,
    lines: [{ productId, name: 'x', ref: 'x', qty, unitUSD: price, costUSD: 1 }],
    discountUSD: 0,
    totalUSD: total,
    payments: [{ method: opts.credit ? 'credit' : 'cash', currency: 'USD', amount: total, amountUSD: total }],
    changeUSD: 0,
  };
}
