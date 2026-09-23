// Report calculations shared by the app (works offline) and the server (daily
// WhatsApp report). Inputs are plain arrays of documents.
import type { CashClose, LedgerEntry, PayMethod, Repayment, Sale, SaleVoid } from './types';
import { round2 } from './money';
import { dayKey, DAY_MS } from './time';

export interface DaySummary {
  day: string;
  storeId: string | null;
  count: number;
  totalUSD: number;
  costUSD: number;
  marginUSD: number;
  discountUSD: number;
  byMethod: Record<string, number>; // `${method}:${currency}` -> amount in that currency (net of change)
  creditUSD: number;
  repaidUSD: number;
  repaidByMethod: Record<string, number>;
  voidedCount: number;
  bySeller: Record<string, { count: number; totalUSD: number }>;
}

export function activeSales(sales: Sale[], voids: SaleVoid[]): Sale[] {
  const voided = new Set(voids.map((v) => v.saleId));
  return sales.filter((s) => !voided.has(s.id));
}

export function saleCost(s: Sale): number {
  return round2(s.lines.reduce((a, l) => a + l.qty * l.costUSD, 0));
}

/** Money actually collected by method/currency, with change given back removed from cash. */
export function collected(s: Sale): Record<string, number> {
  const out: Record<string, number> = {};
  let change = s.changeUSD;
  for (const p of s.payments) {
    if (p.method === 'credit') continue;
    let amount = p.amount;
    if (p.method === 'cash' && change > 0) {
      // change is handed back in the currency of the cash payment
      const changeInCur = p.currency === 'USD' ? change : Math.round((change * s.rate) / 50) * 50;
      const take = Math.min(amount, changeInCur);
      amount -= take;
      change = round2(change - (p.currency === 'USD' ? take : take / s.rate));
    }
    const k = `${p.method}:${p.currency}`;
    out[k] = round2((out[k] ?? 0) + amount);
  }
  return out;
}

export function daySummary(
  day: string,
  storeId: string | null,
  sales: Sale[],
  voids: SaleVoid[],
  repayments: Repayment[],
): DaySummary {
  const inScope = <T extends { storeId: string; at: number }>(x: T) => (!storeId || x.storeId === storeId) && dayKey(x.at) === day;
  const daySales = sales.filter(inScope);
  const dayVoids = voids.filter(inScope);
  const act = activeSales(daySales, voids);
  const sum: DaySummary = {
    day,
    storeId,
    count: act.length,
    totalUSD: 0,
    costUSD: 0,
    marginUSD: 0,
    discountUSD: 0,
    byMethod: {},
    creditUSD: 0,
    repaidUSD: 0,
    repaidByMethod: {},
    voidedCount: dayVoids.length,
    bySeller: {},
  };
  for (const s of act) {
    sum.totalUSD += s.totalUSD;
    sum.costUSD += saleCost(s);
    sum.discountUSD += s.discountUSD;
    for (const [k, v] of Object.entries(collected(s))) sum.byMethod[k] = round2((sum.byMethod[k] ?? 0) + v);
    sum.creditUSD += s.payments.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amountUSD, 0);
    const b = (sum.bySeller[s.userId] ??= { count: 0, totalUSD: 0 });
    b.count++;
    b.totalUSD = round2(b.totalUSD + s.totalUSD);
  }
  for (const r of repayments.filter(inScope)) {
    sum.repaidUSD += r.amountUSD;
    const k = `${r.method}:${r.currency}`;
    sum.repaidByMethod[k] = round2((sum.repaidByMethod[k] ?? 0) + r.amount);
  }
  sum.totalUSD = round2(sum.totalUSD);
  sum.costUSD = round2(sum.costUSD);
  sum.marginUSD = round2(sum.totalUSD - sum.costUSD);
  sum.discountUSD = round2(sum.discountUSD);
  sum.creditUSD = round2(sum.creditUSD);
  sum.repaidUSD = round2(sum.repaidUSD);
  return sum;
}

/** Cash (and mobile money) the drawer should hold at close: sales collected + repayments - refunds. */
export function expectedDrawer(day: string, storeId: string, sales: Sale[], voids: SaleVoid[], repayments: Repayment[]): Record<string, number> {
  const s = daySummary(day, storeId, sales, voids, repayments);
  const out: Record<string, number> = { 'cash:USD': 0, 'cash:CDF': 0 };
  for (const [k, v] of Object.entries(s.byMethod)) out[k] = round2((out[k] ?? 0) + v);
  for (const [k, v] of Object.entries(s.repaidByMethod)) out[k] = round2((out[k] ?? 0) + v);
  // Refunds of voided sales are paid in cash USD on the day of the void.
  for (const v of voids.filter((v) => v.storeId === storeId && dayKey(v.at) === day)) out['cash:USD'] = round2(out['cash:USD'] - v.refundUSD);
  return out;
}

export interface ProductStat {
  productId: string;
  qty: number;
  revenueUSD: number;
  costUSD: number;
  lastSoldAt: number;
}

export function productStats(sales: Sale[], storeId: string | null, from: number, to: number): Map<string, ProductStat> {
  const m = new Map<string, ProductStat>();
  for (const s of sales) {
    if (storeId && s.storeId !== storeId) continue;
    if (s.at < from || s.at >= to) continue;
    const share = s.totalUSD / Math.max(0.01, s.totalUSD + s.discountUSD); // spread the sale discount over lines
    for (const l of s.lines) {
      const st = m.get(l.productId) ?? { productId: l.productId, qty: 0, revenueUSD: 0, costUSD: 0, lastSoldAt: 0 };
      st.qty += l.qty;
      st.revenueUSD = round2(st.revenueUSD + l.qty * l.unitUSD * share);
      st.costUSD = round2(st.costUSD + l.qty * l.costUSD);
      st.lastSoldAt = Math.max(st.lastSoldAt, s.at);
      m.set(l.productId, st);
    }
  }
  return m;
}

export interface CustomerBalance {
  customerId: string;
  balanceUSD: number;
  buckets: { d0_30: number; d31_60: number; d61_90: number; d90p: number };
  oldestUnpaidAt: number | null;
}

/**
 * Debt per customer with aging. Repayments pay off the oldest credit first (FIFO),
 * so what is left unpaid is the most recent credit.
 */
export function customerBalances(ledger: LedgerEntry[], now: number): Map<string, CustomerBalance> {
  const byCustomer = new Map<string, LedgerEntry[]>();
  for (const e of ledger) {
    const a = byCustomer.get(e.customerId) ?? [];
    a.push(e);
    byCustomer.set(e.customerId, a);
  }
  const out = new Map<string, CustomerBalance>();
  for (const [customerId, entries] of byCustomer) {
    entries.sort((a, b) => a.at - b.at);
    const open: { at: number; left: number }[] = [];
    let credit = 0; // payments not yet matched to a debt
    for (const e of entries) {
      if (e.amountUSD > 0) {
        let left = e.amountUSD;
        const use = Math.min(credit, left);
        left -= use;
        credit -= use;
        if (left > 0.004) open.push({ at: e.at, left });
      } else {
        let pay = -e.amountUSD;
        while (pay > 0.004 && open.length) {
          const use = Math.min(pay, open[0].left);
          open[0].left -= use;
          pay -= use;
          if (open[0].left <= 0.004) open.shift();
        }
        credit += pay;
      }
    }
    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    for (const o of open) {
      const age = (now - o.at) / DAY_MS;
      const k = age <= 30 ? 'd0_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90p';
      buckets[k] = round2(buckets[k] + o.left);
    }
    const balanceUSD = round2(entries.reduce((a, e) => a + e.amountUSD, 0));
    out.set(customerId, { customerId, balanceUSD, buckets, oldestUnpaidAt: open[0]?.at ?? null });
  }
  return out;
}

export const METHODS: PayMethod[] = ['cash', 'mpesa', 'airtel', 'orange', 'credit'];

export function closeGaps(c: CashClose): Record<string, number> {
  const keys = new Set([...Object.keys(c.expected), ...Object.keys(c.counted)]);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = round2((c.counted[k] ?? 0) - (c.expected[k] ?? 0));
  return out;
}
