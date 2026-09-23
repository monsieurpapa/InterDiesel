// Creates the first owner account and stores, and optionally a demo history so
// every screen has realistic data. Everything except the very first owner record
// goes through pushOps(), the same path real devices use.
import { ulid } from 'ulid';
import { HLC } from '../shared/hlc';
import { hashPin } from '../shared/pin';
import { round2, toUSD } from '../shared/money';
import { receiveIdFor, stockId } from '../shared/derive';
import type { Op, PayMethod, Payment, Role } from '../shared/types';
import { applyPatch } from '../shared/merge';
import { putRecord, getRecord, type DB } from './db';
import { setCredentials } from './auth';
import { pushOps, type Device } from './sync';
import { CUSTOMERS, PRODUCTS, SUPPLIERS } from './seed-data';

const clock = new HLC('seed');

export interface StoreSeed {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
}

export const DEFAULT_STORES: StoreSeed[] = [
  { id: 'st_ibanda', name: 'Inter-Diesel Ibanda', code: 'IBA', address: 'Av. P.E. Lumumba, Ibanda, Bukavu', phone: '+243990000001' },
  { id: 'st_kadutu', name: 'Inter-Diesel Kadutu', code: 'KAD', address: 'Près du marché de Kadutu, Bukavu', phone: '+243990000002' },
  { id: 'st_bagira', name: 'Inter-Diesel Bagira', code: 'BAG', address: 'Route de Bagira, Bukavu', phone: '+243990000003' },
];

const SEED_DEVICE: Device = { id: 'dev_seed', code: 'S0', scope: null };

function must(db: DB, ops: Op[]) {
  for (let i = 0; i < ops.length; i += 200) {
    const res = pushOps(db, SEED_DEVICE, ops.slice(i, i + 200));
    const bad = res.filter((r) => r.status === 'rejected');
    if (bad.length) throw new Error(`seed rejected: ${JSON.stringify(bad.slice(0, 3))}`);
  }
}

const patch = (kind: any, id: string, userId: string, fields: Record<string, unknown>): Op => ({
  type: 'patch',
  opId: ulid(),
  kind,
  id,
  userId,
  hlc: clock.tick(),
  fields,
});
const doc = (kind: any, userId: string, data: Record<string, any>): Op => ({
  type: 'doc',
  opId: data.id,
  kind,
  userId,
  hlc: clock.tick(),
  data: { deviceId: SEED_DEVICE.id, userId, ...data },
});

export interface BootstrapInput {
  ownerName: string;
  ownerUsername: string;
  ownerPassword: string;
  ownerPin: string;
  stores?: StoreSeed[];
  rate?: number;
}

export async function bootstrap(db: DB, input: BootstrapInput) {
  if (getRecord(db, 'user', 'u_owner')) throw new Error('already_initialised');
  const ownerId = 'u_owner';
  const owner = {
    id: ownerId,
    name: input.ownerName,
    role: 'owner' as Role,
    storeId: null,
    pinHash: await hashPin(input.ownerPin, ownerId),
    phone: '',
    active: true,
  };
  const merged = applyPatch({ id: ownerId }, {}, owner, clock.tick());
  putRecord(db, 'user', ownerId, null, merged.data, merged.clocks);
  setCredentials(db, ownerId, input.ownerUsername, input.ownerPassword);
  db.prepare("INSERT OR IGNORE INTO devices(id, code, name, token_hash, scope, created_by, created_at, revoked) VALUES ('dev_seed','S0','Serveur','-',NULL,'u_owner',?,1)").run(Date.now());

  const stores = input.stores ?? DEFAULT_STORES;
  must(db, stores.map((s) => patch('store', s.id, ownerId, { name: s.name, code: s.code, address: s.address, phone: s.phone, active: true })));
  must(db, [doc('rate', ownerId, { id: ulid(), storeId: stores[0].id, at: Date.now(), cdfPerUsd: input.rate ?? 2300 })]);
  return { ownerId, stores };
}

/** Default team: one manager and two sellers per store (same as the demo). */
export const STAFF = [
  ['st_ibanda', 'Espoir Bisimwa', 'manager', '2222', 'ibanda'],
  ['st_ibanda', 'Grâce Mapendo', 'seller', '1234', null],
  ['st_ibanda', 'Daniel Byamungu', 'seller', '5678', null],
  ['st_kadutu', 'Aline Cirimwami', 'manager', '3333', 'kadutu'],
  ['st_kadutu', 'Olivier Mugisho', 'seller', '1234', null],
  ['st_kadutu', 'Sifa Nsimire', 'seller', '5678', null],
  ['st_bagira', 'Patrick Mushagalusa', 'manager', '4444', 'bagira'],
  ['st_bagira', 'Rachel Zawadi', 'seller', '1234', null],
  ['st_bagira', 'Héritier Kabamba', 'seller', '5678', null],
] as const;

/**
 * Creates the default team. With `withLogins`, managers also get the demo
 * usernames/passwords (demo only: in production the owner sets manager logins).
 * Skips people who already exist, so it can be run twice safely.
 */
export async function createStaff(db: DB, ownerId = 'u_owner', withLogins = false) {
  const users: { id: string; storeId: string; role: Role }[] = [];
  const ops: Op[] = [];
  for (const [i, [storeId, name, role, pin]] of STAFF.entries()) {
    const id = `u_${storeId.slice(3)}_${i}`;
    users.push({ id, storeId, role: role as Role });
    if (!getRecord(db, 'store', storeId) || getRecord(db, 'user', id)) continue;
    ops.push(patch('user', id, ownerId, { name, role, storeId, pinHash: await hashPin(pin, id), phone: '', active: true }));
  }
  if (ops.length) must(db, ops);
  if (withLogins) {
    for (const [i, [storeId, , , , username]] of STAFF.entries()) {
      if (username) setCredentials(db, `u_${storeId.slice(3)}_${i}`, username, `${username}2026`);
    }
  }
  return users;
}

// Deterministic pseudo-random numbers so the demo is the same on every install.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function seedDemo(db: DB, now = Date.now()) {
  const { ownerId, stores } = await bootstrap(db, {
    ownerName: 'Jean-Paul Mirindi',
    ownerUsername: 'proprietaire',
    ownerPassword: 'interdiesel2026',
    ownerPin: '1111',
  });
  const rand = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const DAY = 86_400_000;

  // Users: one manager and two sellers per store.
  const users = await createStaff(db, ownerId, true);

  // Catalog, customers, suppliers, minimum stock.
  const products = PRODUCTS.map((p, i) => ({ ...p, id: `p_${String(i + 1).padStart(3, '0')}` }));
  must(
    db,
    products.map((p) =>
      patch('product', p.id, ownerId, {
        ref: p.ref,
        barcode: p.barcode ?? '',
        name: p.name,
        brand: p.brand,
        category: p.category,
        fits: p.fits,
        costUSD: p.cost,
        priceUSD: p.price,
        priceCDF: null,
        unit: p.unit ?? 'pièce',
        active: true,
      }),
    ),
  );
  const customers = CUSTOMERS.map((c, i) => ({ ...c, id: `c_${String(i + 1).padStart(3, '0')}` }));
  must(db, customers.map((c) => patch('customer', c.id, ownerId, { name: c.name, phone: c.phone, note: '', creditLimitUSD: c.limit, active: true })));
  const suppliers = SUPPLIERS.map((s, i) => ({ ...s, id: `f_${String(i + 1).padStart(3, '0')}` }));
  must(db, suppliers.map((s) => patch('supplier', s.id, ownerId, { name: s.name, phone: s.phone, city: s.city, note: '', active: true })));
  const minOps: Op[] = [];
  for (const s of stores)
    for (const p of products)
      minOps.push(patch('minstock', stockId(s.id, p.id), ownerId, { storeId: s.id, productId: p.id, min: Math.max(2, Math.round(p.initial / 5)) }));
  must(db, minOps);

  // Exchange-rate history.
  const rates = [
    [now - 70 * DAY, 2450],
    [now - 40 * DAY, 2380],
    [now - 12 * DAY, 2310],
  ] as const;
  must(db, rates.map(([at, r]) => doc('rate', ownerId, { id: `rate_${at}`, storeId: stores[0].id, at, cdfPerUsd: r })));
  const rateAt = (t: number) => [...rates].reverse().find(([at]) => at <= t)?.[1] ?? 2450;

  // Opening stock: one purchase per store, 60 days ago.
  const purchaseOps: Op[] = [];
  for (const s of stores) {
    const factor = s.id === 'st_ibanda' ? 1.2 : s.id === 'st_kadutu' ? 1 : 0.8;
    const mgr = users.find((u) => u.storeId === s.id && u.role === 'manager')!;
    const lines = products.map((p) => ({ productId: p.id, qty: Math.max(2, Math.round(p.initial * factor)), unitCostUSD: p.cost }));
    purchaseOps.push(
      doc('purchase', mgr.id, {
        id: `po_open_${s.id}`,
        storeId: s.id,
        at: now - 60 * DAY,
        supplierId: suppliers[0].id,
        invoiceNo: `OUV-${s.code}`,
        lines,
        totalUSD: round2(lines.reduce((a, l) => a + l.qty * l.unitCostUSD, 0)),
        note: "Stock d'ouverture",
      }),
    );
  }
  must(db, purchaseOps);

  // A restock purchase 20 days ago at Kadutu, from Kampala.
  const kadMgr = users.find((u) => u.storeId === 'st_kadutu' && u.role === 'manager')!;
  const restock = products.filter((p) => p.popularity >= 8).map((p) => ({ productId: p.id, qty: 20, unitCostUSD: round2(p.cost * 1.04) }));
  must(db, [
    doc('purchase', kadMgr.id, {
      id: 'po_restock_kad',
      storeId: 'st_kadutu',
      at: now - 20 * DAY,
      supplierId: suppliers[1].id,
      invoiceNo: 'GL-2026-0877',
      lines: restock,
      totalUSD: round2(restock.reduce((a, l) => a + l.qty * l.unitCostUSD, 0)),
    }),
  ]);

  // Sales history: 45 days, weighted by product popularity.
  const weighted: typeof products = [];
  for (const p of products) for (let k = 0; k < p.popularity; k++) weighted.push(p);
  const counters: Record<string, number> = {};
  const saleOps: Op[] = [];
  const creditSales: { id: string; customerId: string; storeId: string; at: number; amount: number }[] = [];
  const stockLeft: Record<string, number> = {};
  for (const s of stores) {
    const factor = s.id === 'st_ibanda' ? 1.2 : s.id === 'st_kadutu' ? 1 : 0.8;
    for (const p of products) stockLeft[stockId(s.id, p.id)] = Math.max(2, Math.round(p.initial * factor)) + (s.id === 'st_kadutu' && p.popularity >= 8 ? 20 : 0);
  }
  for (let day = 45; day >= 0; day--) {
    for (const s of stores) {
      const sellers = users.filter((u) => u.storeId === s.id);
      const n = Math.floor((s.id === 'st_ibanda' ? 10 : s.id === 'st_kadutu' ? 8 : 6) + rand() * 6) - (day === 0 ? 6 : 0);
      for (let k = 0; k < n; k++) {
        const at = now - day * DAY - Math.floor((8 + rand() * 9) * 3_600_000) + (day === 0 ? 10 * 3_600_000 : 0);
        if (at > now) continue;
        const rate = rateAt(at);
        const lineCount = rand() < 0.65 ? 1 : rand() < 0.7 ? 2 : 3;
        const chosen = new Map<string, { p: (typeof products)[number]; qty: number }>();
        for (let j = 0; j < lineCount; j++) {
          const p = pick(weighted);
          const qty = p.category === 'Lubrifiants' || p.price < 3 ? 1 + Math.floor(rand() * 3) : 1;
          const key = stockId(s.id, p.id);
          if (stockLeft[key] - qty < 1) continue; // keep the demo free of negative stock
          stockLeft[key] -= qty;
          chosen.set(p.id, { p, qty: (chosen.get(p.id)?.qty ?? 0) + qty });
        }
        if (!chosen.size) continue;
        const lines = [...chosen.values()].map(({ p, qty }) => ({ productId: p.id, name: p.name, ref: p.ref, qty, unitUSD: p.price, costUSD: p.cost }));
        const gross = round2(lines.reduce((a, l) => a + l.qty * l.unitUSD, 0));
        const discountUSD = gross > 40 && rand() < 0.4 ? round2(Math.floor(gross * 0.05)) : 0;
        const totalUSD = round2(gross - discountUSD);
        const u = pick(sellers);
        const r = rand();
        let payments: Payment[];
        let customerId: string | null = null;
        if (r < 0.14) {
          customerId = pick(customers).id;
          payments = [{ method: 'credit', currency: 'USD', amount: totalUSD, amountUSD: totalUSD }];
        } else if (r < 0.2) {
          customerId = pick(customers).id;
          const cash = round2(Math.floor(totalUSD / 2));
          payments = [
            { method: 'cash', currency: 'USD', amount: cash, amountUSD: cash },
            { method: 'credit', currency: 'USD', amount: round2(totalUSD - cash), amountUSD: round2(totalUSD - cash) },
          ];
        } else {
          const method: PayMethod = r < 0.55 ? 'cash' : r < 0.72 ? 'mpesa' : r < 0.86 ? 'airtel' : r < 0.93 ? 'orange' : 'cash';
          const currency = method === 'cash' && rand() < 0.5 ? 'CDF' : 'USD';
          const amount = currency === 'CDF' ? Math.ceil((totalUSD * rate) / 50) * 50 : totalUSD;
          payments = [{ method, currency, amount, amountUSD: toUSD(amount, currency, rate) }];
        }
        const paid = round2(payments.reduce((a, p) => a + p.amountUSD, 0));
        const c = (counters[s.id] = (counters[s.id] ?? 0) + 1);
        const id = `sa_${s.code}_${String(c).padStart(5, '0')}`;
        saleOps.push(
          doc('sale', u.id, {
            id,
            storeId: s.id,
            at,
            no: `${s.code}-S0-${String(c).padStart(4, '0')}`,
            customerId,
            rate,
            lines,
            discountUSD,
            totalUSD,
            payments,
            changeUSD: round2(Math.max(0, paid - totalUSD)),
          }),
        );
        const credit = payments.find((p) => p.method === 'credit');
        if (credit && customerId) creditSales.push({ id, customerId, storeId: s.id, at, amount: credit.amountUSD });
      }
    }
  }
  must(db, saleOps);

  // Repayments: most older debts are partly or fully repaid.
  const repayOps: Op[] = [];
  for (const cs of creditSales) {
    const age = (now - cs.at) / DAY;
    if (age < 5) continue;
    const r = rand();
    const share = age > 30 ? (r < 0.75 ? 1 : 0.5) : r < 0.4 ? 1 : r < 0.7 ? 0.5 : 0;
    if (!share) continue;
    const amt = round2(cs.amount * share);
    const at = cs.at + Math.floor((2 + rand() * 10) * DAY);
    if (at > now) continue;
    const seller = users.find((u) => u.storeId === cs.storeId && u.role === 'seller')!;
    const method = rand() < 0.6 ? 'cash' : 'mpesa';
    repayOps.push(
      doc('repayment', seller.id, { id: `rp_${cs.id}`, storeId: cs.storeId, at, customerId: cs.customerId, method, currency: 'USD', amount: amt, amountUSD: amt, rate: rateAt(at) }),
    );
  }
  must(db, repayOps);

  // Transfers: one completed, one in transit, one open request.
  const ibaMgr = users.find((u) => u.storeId === 'st_ibanda' && u.role === 'manager')!;
  const bagMgr = users.find((u) => u.storeId === 'st_bagira' && u.role === 'manager')!;
  const t1 = 'tr_demo_1';
  must(db, [
    doc('transfer_send', ibaMgr.id, { id: t1, storeId: 'st_ibanda', at: now - 9 * DAY, toStoreId: 'st_bagira', lines: [{ productId: 'p_001', qty: 5 }, { productId: 'p_037', qty: 10 }] }),
    doc('transfer_receive', bagMgr.id, { id: receiveIdFor(t1), storeId: 'st_bagira', at: now - 8 * DAY, sendId: t1, fromStoreId: 'st_ibanda', lines: [{ productId: 'p_001', qty: 5 }, { productId: 'p_037', qty: 10 }] }),
    doc('transfer_send', kadMgr.id, { id: 'tr_demo_2', storeId: 'st_kadutu', at: now - 3 * 3_600_000, toStoreId: 'st_ibanda', lines: [{ productId: 'p_018', qty: 10 }, { productId: 'p_029', qty: 8 }] }),
    doc('transfer_request', bagMgr.id, { id: 'rq_demo_1', storeId: 'st_bagira', at: now - 2 * 3_600_000, fromStoreId: 'st_kadutu', lines: [{ productId: 'p_026', qty: 4 }, { productId: 'p_027', qty: 4 }], note: 'Urgent, client garage Tujenge' }),
    doc('adjustment', ibaMgr.id, { id: 'adj_demo_1', storeId: 'st_ibanda', at: now - 6 * DAY, productId: 'p_021', qty: -3, reason: 'damaged', note: 'Ampoules cassées au déballage' }),
    doc('adjustment', bagMgr.id, { id: 'adj_demo_2', storeId: 'st_bagira', at: now - 4 * DAY, productId: 'p_028', qty: 2, reason: 'found', note: 'Retrouvées dans la réserve' }),
  ]);
  return { ownerId, stores, users, products: products.length, sales: saleOps.length };
}
