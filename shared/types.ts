// Shared data model used by both the PWA client and the server.
// Money is always stored in USD (number, 2 decimals) with the exchange rate
// snapshot kept on each document, so CDF amounts can be recomputed exactly.

export type Role = 'owner' | 'manager' | 'seller';
export type Currency = 'USD' | 'CDF';
export type PayMethod = 'cash' | 'mpesa' | 'airtel' | 'orange' | 'credit';

/** Mutable records: merged field by field, last writer wins (by HLC). */
export const ENTITY_KINDS = [
  'store',
  'user',
  'product',
  'customer',
  'supplier',
  'minstock',
  'photo',
  'alert',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Immutable documents: created once, never edited. Merged by union on id. */
export const DOC_KINDS = [
  'sale',
  'sale_void',
  'repayment',
  'purchase',
  'adjustment',
  'count',
  'transfer_request',
  'transfer_send',
  'transfer_receive',
  'cash_close',
  'rate',
  'reversal',
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Read models computed by the server from documents. Never pushed by clients. */
export const DERIVED_KINDS = ['movement', 'stock', 'ledger', 'audit'] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];

export type Kind = EntityKind | DocKind | DerivedKind;

export function isEntityKind(k: string): k is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(k);
}
export function isDocKind(k: string): k is DocKind {
  return (DOC_KINDS as readonly string[]).includes(k);
}

// ---------- Entities ----------

export interface Store {
  id: string;
  name: string;
  code: string; // short code used in receipt numbers, e.g. "IBA"
  address?: string;
  phone?: string; // WhatsApp number of the store, international format
  active: boolean;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  storeId: string | null; // null for the owner (all stores)
  pinHash: string; // PBKDF2 of the PIN, needed on device for offline login
  phone?: string;
  active: boolean;
  username?: string; // owners/managers only, for enrolling devices online
}

export interface Fitment {
  brand: string; // e.g. "Bajaj"
  model: string; // e.g. "Boxer BM150"
  years?: string; // e.g. "2015-2023"
}

export interface Product {
  id: string;
  ref: string; // reference / OEM number
  barcode?: string;
  name: string;
  brand?: string;
  category: string;
  fits: Fitment[];
  costUSD: number;
  priceUSD: number;
  priceCDF?: number | null; // fixed CDF price; null = computed from the rate
  unit?: string; // "pièce", "litre", "kit"...
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  note?: string;
  creditLimitUSD?: number | null;
  active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  city?: string;
  note?: string;
  active: boolean;
}

export interface MinStock {
  id: string; // `${storeId}:${productId}`
  storeId: string;
  productId: string;
  min: number;
}

export interface Photo {
  id: string; // = productId
  dataUrl: string;
}

export type AlertType =
  | 'negative_stock'
  | 'transfer_gap'
  | 'inactive_user'
  | 'count_gap'
  | 'rejected_op';

export interface Alert {
  id: string;
  storeId: string | null;
  type: AlertType;
  productId?: string;
  qty?: number;
  ref?: string;
  message?: string;
  at: number;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
}

// ---------- Documents ----------

interface DocBase {
  id: string;
  storeId: string;
  userId: string;
  deviceId: string;
  at: number; // device time (ms) when created
}

export interface SaleLine {
  productId: string;
  name: string; // snapshot for receipts
  ref: string;
  qty: number;
  unitUSD: number; // price actually charged per unit, before sale discount
  costUSD: number; // cost snapshot, for margins
}

export interface Payment {
  method: PayMethod;
  currency: Currency;
  amount: number; // in `currency`
  amountUSD: number; // converted at the sale's rate
}

export interface Sale extends DocBase {
  no: string; // human receipt number, unique per device
  customerId?: string | null;
  rate: number; // CDF per USD at the time of the sale
  lines: SaleLine[];
  discountUSD: number;
  totalUSD: number; // sum(lines) - discount
  payments: Payment[]; // sum(amountUSD) >= totalUSD, credit included
  changeUSD: number; // cash handed back
  note?: string;
}

export interface SaleVoid extends DocBase {
  saleId: string;
  saleNo: string;
  reason: string;
  lines: { productId: string; qty: number }[];
  customerId?: string | null;
  creditUSD: number;
  refundUSD: number;
}

export interface Repayment extends DocBase {
  customerId: string;
  method: Exclude<PayMethod, 'credit'>;
  currency: Currency;
  amount: number;
  amountUSD: number;
  rate: number;
  note?: string;
}

export interface Purchase extends DocBase {
  supplierId: string | null;
  invoiceNo?: string;
  lines: { productId: string; qty: number; unitCostUSD: number }[];
  totalUSD: number;
  note?: string;
}

export type AdjustReason =
  | 'damaged'
  | 'lost'
  | 'found'
  | 'returned_supplier'
  | 'customer_return'
  | 'correction'
  | 'other';

export interface Adjustment extends DocBase {
  productId: string;
  qty: number; // signed delta
  reason: AdjustReason;
  note: string;
}

export interface Count extends DocBase {
  lines: { productId: string; expected: number; counted: number }[];
  note?: string;
}

export interface TransferLine {
  productId: string;
  qty: number;
}

export interface TransferRequest extends DocBase {
  // storeId = the store asking; fromStoreId = the store asked to send
  fromStoreId: string;
  lines: TransferLine[];
  note?: string;
}

export interface TransferSend extends DocBase {
  // storeId = sending store
  toStoreId: string;
  requestId?: string | null;
  lines: TransferLine[];
  note?: string;
}

export interface TransferReceive extends DocBase {
  // storeId = receiving store
  sendId: string;
  fromStoreId: string;
  lines: TransferLine[]; // quantities actually received
  note?: string;
}

export interface CashClose extends DocBase {
  day: string; // YYYY-MM-DD
  expected: Record<string, number>; // key `${method}:${currency}`
  counted: Record<string, number>;
  note?: string;
}

export interface RateDoc extends DocBase {
  cdfPerUsd: number;
}

/** Kinds of documents the owner can cancel with a reversal (sales use sale_void). */
export const REVERSIBLE_KINDS = ['purchase', 'adjustment', 'count', 'transfer_send', 'transfer_receive', 'transfer_request', 'repayment', 'cash_close'] as const;
export type ReversibleKind = (typeof REVERSIBLE_KINDS)[number];

/**
 * Cancels an earlier document by adding its exact opposite (documents are never
 * edited or deleted, so history stays complete). The server rebuilds the opposite
 * movements and debts from its own copy of the original.
 */
export interface Reversal extends DocBase {
  refKind: ReversibleKind;
  refId: string;
  reason: string;
  movements: { storeId: string; productId: string; qty: number }[];
  ledger: { customerId: string; amountUSD: number }[];
}

// ---------- Derived ----------

export type MovementKind =
  | 'sale'
  | 'void'
  | 'purchase'
  | 'adjustment'
  | 'count'
  | 'transfer_out'
  | 'transfer_in'
  | 'reversal';

export interface Movement {
  id: string;
  storeId: string;
  productId: string;
  qty: number; // signed
  kind: MovementKind;
  ref: string; // source document id
  at: number;
  userId: string;
}

export interface StockLevel {
  id: string; // `${storeId}:${productId}`
  storeId: string;
  productId: string;
  qty: number;
}

export type LedgerKind = 'credit_sale' | 'repayment' | 'void' | 'reversal';

export interface LedgerEntry {
  id: string;
  customerId: string;
  storeId: string;
  amountUSD: number; // + customer owes more, - customer paid
  kind: LedgerKind;
  ref: string;
  at: number;
}

export interface AuditEntry {
  id: string;
  storeId: string | null;
  userId: string;
  deviceId: string;
  at: number;
  kind: string;
  refId: string;
  summary: string;
  changes?: Record<string, [unknown, unknown]>;
}

// ---------- Sync protocol ----------

export interface DocOp {
  type: 'doc';
  opId: string; // = doc id
  kind: DocKind;
  userId: string;
  hlc: string;
  data: Record<string, unknown>;
}

export interface PatchOp {
  type: 'patch';
  opId: string;
  kind: EntityKind;
  id: string;
  userId: string;
  hlc: string;
  fields: Record<string, unknown>;
}

export type Op = DocOp | PatchOp;

export interface PushResult {
  opId: string;
  status: 'ok' | 'duplicate' | 'rejected' | 'error';
  error?: string;
}

export interface Change {
  seq: number;
  kind: Kind;
  id: string;
  data: Record<string, unknown>;
}

export interface PullResponse {
  changes: Change[];
  nextSeq: number;
  more: boolean;
  serverTime: number;
  epoch: string; // changes when the server database is restored from a backup
}
