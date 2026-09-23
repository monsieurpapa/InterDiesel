// Pure functions that turn a document into stock movements and customer-debt
// ledger entries. The client runs them to show the effect of a sale while
// offline; the server runs the same code when the document arrives. The ids are
// deterministic, so the client's local copies and the server's copies are the
// same rows and never double count.

import type {
  Adjustment,
  Count,
  DocKind,
  LedgerEntry,
  Movement,
  Purchase,
  Repayment,
  Reversal,
  Sale,
  SaleVoid,
  TransferReceive,
  TransferSend,
} from './types';
import { round2 } from './money';

export interface Derived {
  movements: Movement[];
  ledger: LedgerEntry[];
}

export function creditOf(sale: Pick<Sale, 'payments'>): number {
  return round2(sale.payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amountUSD, 0));
}

export function derive(kind: DocKind, d: any): Derived {
  const movements: Movement[] = [];
  const ledger: LedgerEntry[] = [];
  const mv = (i: number | string, storeId: string, productId: string, qty: number, k: Movement['kind']) => {
    if (qty === 0) return;
    movements.push({ id: `${d.id}:m${i}`, storeId, productId, qty, kind: k, ref: d.id, at: d.at, userId: d.userId });
  };

  switch (kind) {
    case 'sale': {
      const s = d as Sale;
      s.lines.forEach((l, i) => mv(i, s.storeId, l.productId, -l.qty, 'sale'));
      const credit = creditOf(s);
      if (credit > 0 && s.customerId) {
        ledger.push({ id: `${s.id}:l`, customerId: s.customerId, storeId: s.storeId, amountUSD: credit, kind: 'credit_sale', ref: s.id, at: s.at });
      }
      break;
    }
    case 'sale_void': {
      const v = d as SaleVoid;
      v.lines.forEach((l, i) => mv(i, v.storeId, l.productId, l.qty, 'void'));
      if (v.creditUSD > 0 && v.customerId) {
        ledger.push({ id: `${v.id}:l`, customerId: v.customerId, storeId: v.storeId, amountUSD: -v.creditUSD, kind: 'void', ref: v.id, at: v.at });
      }
      break;
    }
    case 'repayment': {
      const r = d as Repayment;
      ledger.push({ id: `${r.id}:l`, customerId: r.customerId, storeId: r.storeId, amountUSD: -r.amountUSD, kind: 'repayment', ref: r.id, at: r.at });
      break;
    }
    case 'purchase': {
      const p = d as Purchase;
      p.lines.forEach((l, i) => mv(i, p.storeId, l.productId, l.qty, 'purchase'));
      break;
    }
    case 'adjustment': {
      const a = d as Adjustment;
      mv(0, a.storeId, a.productId, a.qty, 'adjustment');
      break;
    }
    case 'count': {
      const c = d as Count;
      c.lines.forEach((l, i) => mv(i, c.storeId, l.productId, l.counted - l.expected, 'count'));
      break;
    }
    case 'transfer_send': {
      const t = d as TransferSend;
      t.lines.forEach((l, i) => mv(i, t.storeId, l.productId, -l.qty, 'transfer_out'));
      break;
    }
    case 'transfer_receive': {
      const t = d as TransferReceive;
      t.lines.forEach((l, i) => mv(i, t.storeId, l.productId, l.qty, 'transfer_in'));
      break;
    }
    case 'reversal': {
      const r = d as Reversal;
      r.movements.forEach((m, i) => mv(i, m.storeId, m.productId, m.qty, 'reversal'));
      r.ledger.forEach((l, i) =>
        ledger.push({ id: `${r.id}:l${i}`, customerId: l.customerId, storeId: r.storeId, amountUSD: l.amountUSD, kind: 'reversal', ref: r.id, at: r.at }),
      );
      break;
    }
    default:
      break;
  }
  return { movements, ledger };
}

/** The opposite effects of a document, used to fill a reversal. */
export function inverseOf(kind: DocKind, d: any): Pick<Reversal, 'movements' | 'ledger'> {
  const { movements, ledger } = derive(kind, d);
  return {
    movements: movements.map((m) => ({ storeId: m.storeId, productId: m.productId, qty: -m.qty })),
    ledger: ledger.map((l) => ({ customerId: l.customerId, amountUSD: -l.amountUSD })),
  };
}

/** Deterministic id: a document can be reversed only once. */
export const reversalIdFor = (refId: string) => `rev_${refId}`;

/** The store a document belongs to (for permissions and who may see it). */
export function docStore(kind: DocKind, d: any): string {
  return d.storeId;
}

/**
 * Pull visibility of a document: null means every device sees it.
 * Transfers, rates and requests concern several stores, so they are global.
 */
export function docScope(kind: DocKind, d: any): string | null {
  if (kind === 'transfer_request' || kind === 'transfer_send' || kind === 'transfer_receive' || kind === 'rate') return null;
  if (kind === 'reversal' && String(d.refKind).startsWith('transfer_')) return null;
  return d.storeId;
}

/** Deterministic id of the single void allowed per sale. */
export const voidIdFor = (saleId: string) => `void_${saleId}`;
/** Deterministic id of the single reception allowed per transfer. */
export const receiveIdFor = (sendId: string) => `recv_${sendId}`;
export const stockId = (storeId: string, productId: string) => `${storeId}:${productId}`;
