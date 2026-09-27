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
  // garage: chef d'atelier (manager), two mechanics, reception/cashier (seller)
  ['st_garage', 'Jean-Marie Kasongo', 'manager', '7777', 'garage'],
  ['st_garage', 'Faustin Bahati', 'mechanic', '1234', null],
  ['st_garage', 'Josué Amani', 'mechanic', '5678', null],
  ['st_garage', 'Nadine Furaha', 'seller', '2468', null],
] as const;

export const GARAGE: StoreSeed & { kind: 'garage' } = { id: 'st_garage', name: 'Inter-Diesel Garage', code: 'GAR', address: 'Bukavu', phone: '+243990000004', kind: 'garage' };

/** Standard garage work with a starting labour price (the garage chief adjusts them). */
export const DEFAULT_SERVICES: [string, string, number][] = [
  ['Entretien', 'Vidange moteur + filtre à huile', 15],
  ['Entretien', 'Révision complète (filtres, niveaux, contrôle)', 45],
  ['Entretien', 'Remplacement filtre à gasoil', 10],
  ['Entretien', 'Remplacement filtre à air', 5],
  ['Diagnostic', 'Diagnostic moteur', 20],
  ['Diagnostic', 'Diagnostic électrique', 20],
  ['Freinage', 'Plaquettes de frein avant', 20],
  ['Freinage', 'Mâchoires / plaquettes arrière', 25],
  ['Freinage', 'Purge du circuit de freinage', 15],
  ['Train roulant', 'Amortisseurs (la paire)', 30],
  ['Train roulant', 'Rotules de direction', 25],
  ['Train roulant', 'Parallélisme', 15],
  ['Transmission', "Kit d'embrayage", 80],
  ['Transmission', 'Vidange boîte et pont', 20],
  ['Moteur', 'Courroie alternateur / accessoires', 15],
  ['Moteur', 'Pompe à eau', 45],
  ['Moteur', 'Joints injecteurs', 40],
  ['Électricité', 'Batterie (pose et contrôle charge)', 5],
  ['Électricité', 'Réparation faisceau électrique (heure)', 15],
  ['Carrosserie', 'Soudure (heure)', 20],
  ['Pneus', 'Montage + équilibrage (par roue)', 5],
];

/** Creates the garage (workshop) and its price list if they do not exist yet. */
export function ensureGarage(db: DB, ownerId = 'u_owner') {
  const ops: Op[] = [];
  if (!getRecord(db, 'store', GARAGE.id)) {
    ops.push(patch('store', GARAGE.id, ownerId, { name: GARAGE.name, code: GARAGE.code, address: GARAGE.address, phone: GARAGE.phone, kind: 'garage', active: true }));
  }
  const hasServices = (db.prepare("SELECT COUNT(*) n FROM records WHERE kind = 'service'").get() as any).n > 0;
  if (!hasServices) {
    DEFAULT_SERVICES.forEach(([category, name, priceUSD], i) => ops.push(patch('service', `sv_${String(i + 1).padStart(2, '0')}`, ownerId, { name, category, priceUSD, active: true })));
  }
  if (ops.length) must(db, ops);
}

/**
 * Creates the default team. With `withLogins`, managers also get the demo
 * usernames/passwords (demo only: in production the owner sets manager logins).
 * Skips people who already exist, so it can be run twice safely.
 */
export async function createStaff(db: DB, ownerId = 'u_owner', withLogins = false) {
  ensureGarage(db, ownerId);
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
  await seedGarageDemo(db, ownerId, now, rateAt);
  return { ownerId, stores, users, products: products.length, sales: saleOps.length };
}

/** Demo workshop: an NGO fleet, a company, private cars, jobs at every step. */
async function seedGarageDemo(db: DB, ownerId: string, now: number, rateAt: (at: number) => number) {
  const DAY = 86_400_000;
  const H = 3_600_000;
  const chef = 'u_garage_9';
  const meca1 = 'u_garage_10';
  const meca2 = 'u_garage_11';
  const recep = 'u_garage_12';
  const price = (id: string) => getRecord(db, 'product', id)!.data as any;
  must(db, [
    patch('customer', 'c_ngo1', ownerId, { name: 'ONG Santé Kivu', phone: '+243997000111', note: 'Paiement mensuel sur relevé', creditLimitUSD: 5000, type: 'ngo', poRequired: true, active: true }),
    patch('customer', 'c_co1', ownerId, { name: 'Kivu Transport SARL', phone: '+243998000222', note: '', creditLimitUSD: 2000, type: 'company', poRequired: false, active: true }),
    patch('vehicle', 'v_demo_1', ownerId, { plate: 'CGO 4521 BK', make: 'Toyota', model: 'Land Cruiser 79', year: '2019', color: 'Blanc', vin: '', customerId: 'c_ngo1', km: 142300, note: '', active: true }),
    patch('vehicle', 'v_demo_2', ownerId, { plate: 'CGO 7710 BK', make: 'Toyota', model: 'Land Cruiser 79', year: '2020', color: 'Blanc', vin: '', customerId: 'c_ngo1', km: 98100, nextServiceKm: 102000, nextServiceAt: now + 5 * DAY, note: '', active: true }),
    patch('vehicle', 'v_demo_3', ownerId, { plate: 'CGO 3309 AA', make: 'Toyota', model: 'Hilux', year: '2017', color: 'Gris', vin: '', customerId: 'c_co1', km: 188400, note: '', active: true }),
    patch('vehicle', 'v_demo_4', ownerId, { plate: 'CGO 1188 BB', make: 'Toyota', model: 'Hiace', year: '2015', color: 'Blanc', vin: '', customerId: 'c_co1', km: 251000, nextServiceKm: 250500, nextServiceAt: now - 3 * DAY, note: '', active: true }),
    patch('vehicle', 'v_demo_5', ownerId, { plate: 'CGO 5042 AB', make: 'Toyota', model: 'Corolla', year: '2012', color: 'Rouge', vin: '', customerId: 'c_001', km: 203500, note: '', active: true }),
  ]);
  // a small shelf of consumables at the garage
  must(db, [doc('purchase', chef, { id: 'po_garage_1', storeId: 'st_garage', at: now - 30 * DAY, supplierId: null, lines: [{ productId: 'p_039', qty: 12, unitCostUSD: 18 }, { productId: 'p_045', qty: 10, unitCostUSD: 3 }, { productId: 'p_048', qty: 8, unitCostUSD: 4 }, { productId: 'p_043', qty: 10, unitCostUSD: 2 }], totalUSD: 310 })]);

  const job = (id: string, fields: Record<string, unknown>, by = recep) => patch('job', id, by, { mechanicIds: [], needs: [], arrivalItems: [], photoIds: [], ...fields });
  const lab = (name: string, unitUSD: number, qty = 1) => ({ serviceId: null, name, qty, unitUSD });
  const line = (pid: string, qty: number) => ({ productId: pid, name: price(pid).name, qty, unitUSD: price(pid).priceUSD, costUSD: price(pid).costUSD });

  // 1. NGO Land Cruiser, approved, being repaired, parts already handed out by Ibanda
  const j1Labour = [lab('Plaquettes de frein avant', 20), lab('Purge du circuit de freinage', 15), lab('Vidange moteur + filtre à huile', 15)];
  must(db, [
    job('j_demo_1', { no: 'GAR-OR-S001', storeId: 'st_garage', vehicleId: 'v_demo_1', customerId: 'c_ngo1', status: 'in_progress', arrivedAt: now - 3 * DAY, km: 142300, fuel: 3, keyTag: 'A12', complaint: 'Bruit métallique au freinage, vidange à faire', arrivalItems: ['spare_wheel', 'jack', 'triangle', 'documents'], damage: 'Rayure aile arrière gauche', contactName: 'Patrick (chauffeur)', contactPhone: '+243997000112', poNumber: 'PO-SK-2026-041' }),
    patch('job', 'j_demo_1', meca1, { mechanicIds: [meca1], ck_oil_level: { s: 'fix', note: 'Huile noire, vidange dépassée' }, ck_brake_pads_front: { s: 'fix', note: 'Usées jusqu’au métal' }, ck_brake_discs: { s: 'watch', note: 'Légèrement rayés' }, ck_brake_fluid: { s: 'fix' }, ck_tyres: { s: 'ok' }, ck_battery: { s: 'ok' }, ck_lights_front: { s: 'ok' }, ck_steering: { s: 'ok' }, diagnosis: 'Plaquettes avant à remplacer, disques à surveiller. Liquide de frein à changer. Vidange + filtre.', needs: [{ productId: 'p_054', qty: 1, fromStoreId: 'st_ibanda' }, { productId: 'p_043', qty: 1, fromStoreId: 'st_garage' }, { productId: 'p_039', qty: 2, fromStoreId: 'st_garage' }, { productId: 'p_045', qty: 1, fromStoreId: 'st_garage' }] }),
    patch('job', 'j_demo_1', chef, { labour: j1Labour, quoteSentAt: now - 2 * DAY - 4 * H, approvedTotalUSD: round2(50 + price('p_054').priceUSD + price('p_043').priceUSD + 2 * price('p_039').priceUSD + price('p_045').priceUSD), approvedAt: now - 2 * DAY, approvedBy: 'Dr Mapendo (logisticien)', approvedVia: 'purchase_order' }),
  ]);
  must(db, [
    doc('issue', 'u_ibanda_1', { id: 'bs_demo_1', storeId: 'st_ibanda', at: now - 2 * DAY + 2 * H, no: 'IBA-BS-S001', jobId: 'j_demo_1', jobNo: 'GAR-OR-S001', lines: [line('p_054', 1)], takenBy: 'Faustin Bahati' }),
    doc('issue', meca1, { id: 'bs_demo_2', storeId: 'st_garage', at: now - 2 * DAY + 3 * H, no: 'GAR-BS-S001', jobId: 'j_demo_1', jobNo: 'GAR-OR-S001', lines: [line('p_043', 1), line('p_039', 2), line('p_045', 1)], takenBy: 'Faustin Bahati' }),
  ]);

  // 2. Company Hilux waiting for shock absorbers from Bagira (a pending bon de sortie there)
  must(db, [
    job('j_demo_2', { no: 'GAR-OR-S002', storeId: 'st_garage', vehicleId: 'v_demo_3', customerId: 'c_co1', status: 'waiting_parts', arrivedAt: now - 2 * DAY, km: 188400, fuel: 5, keyTag: 'A07', complaint: 'Le véhicule tape à l’avant sur la route de Kavumu', arrivalItems: ['spare_wheel', 'radio'], contactName: 'Chauffeur Amisi', contactPhone: '+243998000223' }),
    patch('job', 'j_demo_2', meca2, { mechanicIds: [meca2], ck_shock_absorbers: { s: 'fix', note: 'Les deux avant fuient' }, ck_ball_joints: { s: 'watch' }, ck_tyres: { s: 'ok' }, diagnosis: 'Amortisseurs avant HS.', needs: [{ productId: 'p_062', qty: 2, fromStoreId: 'st_bagira' }] }),
    patch('job', 'j_demo_2', chef, { labour: [lab('Amortisseurs (la paire)', 30)], quoteSentAt: now - DAY - 5 * H, approvedTotalUSD: round2(30 + 2 * price('p_062').priceUSD), approvedAt: now - DAY, approvedBy: 'M. Kalume', approvedVia: 'phone' }),
  ]);

  // 3. Private Corolla, just arrived
  must(db, [job('j_demo_3', { no: 'GAR-OR-S003', storeId: 'st_garage', vehicleId: 'v_demo_5', customerId: 'c_001', status: 'arrived', arrivedAt: now - 2 * H, km: 203500, fuel: 2, keyTag: 'B03', complaint: 'Voyant batterie allumé, démarrage difficile le matin', arrivalItems: ['spare_wheel'], contactName: '', contactPhone: '' })]);

  // 4. Company Hiace: ready, invoiced and paid in cash
  const j4Labour = [lab('Remplacement filtre à gasoil', 10), lab('Diagnostic moteur', 20)];
  must(db, [
    job('j_demo_4', { no: 'GAR-OR-S004', storeId: 'st_garage', vehicleId: 'v_demo_4', customerId: 'c_co1', status: 'in_progress', arrivedAt: now - DAY - 6 * H, km: 251000, fuel: 4, complaint: 'Perte de puissance en montée', contactName: 'Chauffeur Amisi', contactPhone: '+243998000223' }),
    patch('job', 'j_demo_4', meca1, { mechanicIds: [meca1], ck_fuel_filter: { s: 'fix' }, ck_injection: { s: 'watch' }, diagnosis: 'Filtre à gasoil colmaté.', needs: [{ productId: 'p_048', qty: 1, fromStoreId: 'st_garage' }] }),
    patch('job', 'j_demo_4', chef, { labour: j4Labour }),
  ]);
  must(db, [doc('issue', meca1, { id: 'bs_demo_3', storeId: 'st_garage', at: now - DAY, no: 'GAR-BS-S002', jobId: 'j_demo_4', jobNo: 'GAR-OR-S004', lines: [line('p_048', 1)], takenBy: 'Faustin Bahati' })]);
  const j4Lines = [
    { kind: 'part', productId: 'p_048', serviceId: null, name: price('p_048').name, ref: price('p_048').ref, qty: 1, unitUSD: price('p_048').priceUSD, costUSD: price('p_048').costUSD },
    ...j4Labour.map((l) => ({ kind: 'labour', productId: null, serviceId: null, name: l.name, ref: '', qty: 1, unitUSD: l.unitUSD, costUSD: 0 })),
  ];
  const j4Total = round2(j4Lines.reduce((a, l) => a + l.qty * l.unitUSD, 0));
  must(db, [
    doc('job_invoice', recep, { id: 'fg_demo_1', storeId: 'st_garage', at: now - 3 * H, no: 'GAR-FG-S001', jobId: 'j_demo_4', jobNo: 'GAR-OR-S004', vehicleId: 'v_demo_4', customerId: 'c_co1', rate: rateAt(now), lines: j4Lines, discountUSD: 0, totalUSD: j4Total, payments: [{ method: 'cash', currency: 'USD', amount: j4Total, amountUSD: j4Total }], changeUSD: 0 }),
    patch('job', 'j_demo_4', recep, { status: 'ready', invoiceId: 'fg_demo_1' }),
  ]);

  // 5. NGO Land Cruiser delivered 3 weeks ago, invoiced on the NGO's account with its PO
  const j5Labour = [lab('Révision complète (filtres, niveaux, contrôle)', 45)];
  must(db, [
    job('j_demo_5', { no: 'GAR-OR-S000', storeId: 'st_garage', vehicleId: 'v_demo_2', customerId: 'c_ngo1', status: 'in_progress', arrivedAt: now - 22 * DAY, km: 97000, fuel: 6, complaint: 'Révision 97 000 km', poNumber: 'PO-SK-2026-033' }),
    patch('job', 'j_demo_5', chef, { labour: j5Labour, approvedTotalUSD: 45, approvedAt: now - 22 * DAY, approvedBy: 'Dr Mapendo', approvedVia: 'purchase_order' }),
  ]);
  const j5Total = 45;
  must(db, [
    doc('job_invoice', chef, { id: 'fg_demo_0', storeId: 'st_garage', at: now - 21 * DAY, no: 'GAR-FG-S000', jobId: 'j_demo_5', jobNo: 'GAR-OR-S000', vehicleId: 'v_demo_2', customerId: 'c_ngo1', poNumber: 'PO-SK-2026-033', rate: rateAt(now - 21 * DAY), lines: j5Labour.map((l) => ({ kind: 'labour', productId: null, serviceId: null, name: l.name, ref: '', qty: 1, unitUSD: l.unitUSD, costUSD: 0 })), discountUSD: 0, totalUSD: j5Total, payments: [{ method: 'credit', currency: 'USD', amount: j5Total, amountUSD: j5Total }], changeUSD: 0 }),
    patch('job', 'j_demo_5', recep, { status: 'delivered', invoiceId: 'fg_demo_0', deliveredAt: now - 21 * DAY + 4 * H, deliveredTo: 'Patrick (chauffeur)', exitKm: 97010, nextServiceKm: 102000, nextServiceAt: now + 5 * DAY }),
  ]);
}
