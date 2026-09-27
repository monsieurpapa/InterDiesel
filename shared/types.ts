// Shared data model used by both the PWA client and the server.
// Money is always stored in USD (number, 2 decimals) with the exchange rate
// snapshot kept on each document, so CDF amounts can be recomputed exactly.

export type Role = 'owner' | 'manager' | 'seller' | 'mechanic';
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
  // garage
  'vehicle',
  'service',
  'job',
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
  // garage
  'issue',
  'job_invoice',
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
  /** 'garage' = the workshop: it has its own small parts shelf and repair jobs. */
  kind?: 'shop' | 'garage';
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
  /** person, company or NGO: companies and NGOs usually own several vehicles and pay monthly. */
  type?: 'person' | 'company' | 'ngo';
  /** The customer requires its purchase-order number on every garage job and invoice. */
  poRequired?: boolean;
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

// ---------- Garage ----------

export interface Vehicle {
  id: string;
  plate: string; // registration, the way people look a vehicle up
  make: string; // Toyota
  model: string; // Land Cruiser 79
  year?: string;
  vin?: string;
  color?: string;
  customerId: string | null; // owner / fleet
  km?: number; // last odometer reading seen
  nextServiceKm?: number | null;
  nextServiceAt?: number | null;
  note?: string;
  active: boolean;
}

/** A standard piece of work with its labour price (vidange, plaquettes, diagnostic...). */
export interface Service {
  id: string;
  name: string;
  category: string;
  priceUSD: number;
  active: boolean;
}

export const JOB_STATUSES = ['arrived', 'diagnosis', 'quote', 'approved', 'in_progress', 'waiting_parts', 'ready', 'delivered', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type CheckState = 'ok' | 'watch' | 'fix' | 'na';

export interface LabourLine {
  serviceId: string | null;
  name: string;
  qty: number;
  unitUSD: number;
}

/** Parts the job needs; shops (or the garage shelf) hand them out on a bon de sortie. */
export interface NeedLine {
  productId: string;
  qty: number;
  fromStoreId: string;
}

/**
 * A repair job (ordre de réparation). Mutable: mechanics, reception and the garage
 * chief fill it in over several days. Each checklist item is its own field
 * (`ck_<item>`), so two mechanics ticking different items never overwrite each other.
 */
export interface Job {
  id: string;
  no: string;
  storeId: string; // the garage
  vehicleId: string;
  customerId: string | null;
  status: JobStatus;
  arrivedAt: number;
  km?: number;
  fuel?: number; // eighths of a tank, 0-8
  keyTag?: string;
  complaint: string; // what the customer says
  arrivalItems?: string[]; // things left in the vehicle: spare wheel, jack, radio...
  damage?: string; // visible damage on arrival
  photoIds?: string[]; // photo records `job_<id>_<n>`
  contactName?: string;
  contactPhone?: string;
  mechanicIds?: string[];
  diagnosis?: string;
  labour?: LabourLine[];
  needs?: NeedLine[];
  poNumber?: string;
  promisedAt?: number | null;
  quoteSentAt?: number | null;
  approvedTotalUSD?: number | null; // estimate total the customer agreed to
  approvedAt?: number | null;
  approvedBy?: string;
  approvedVia?: 'in_person' | 'phone' | 'whatsapp' | 'purchase_order';
  invoiceId?: string | null;
  deliveredAt?: number | null;
  deliveredTo?: string;
  exitKm?: number;
  signature?: string; // PNG data URL drawn on the phone
  nextServiceKm?: number | null;
  nextServiceAt?: number | null;
  [check: `ck_${string}`]: { s: CheckState; note?: string } | undefined;
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

/**
 * Bon de sortie: parts handed out of a store's stock for a garage job (storeId = the
 * store the parts leave). `returned` = unused parts brought back to the store.
 */
export interface Issue extends DocBase {
  no: string;
  jobId: string;
  jobNo: string;
  lines: { productId: string; name: string; qty: number; unitUSD: number; costUSD: number }[];
  returned?: boolean;
  takenBy: string; // name of the person who carried the parts to the workshop
  note?: string;
}

export interface JobInvoiceLine {
  kind: 'part' | 'labour';
  productId?: string | null;
  serviceId?: string | null;
  name: string;
  ref: string;
  qty: number;
  unitUSD: number;
  costUSD: number;
}

/** The garage invoice of a job. Paid now, on credit (debt), or a mix, like a sale. */
export interface JobInvoice extends DocBase {
  no: string;
  jobId: string;
  jobNo: string;
  vehicleId: string;
  customerId?: string | null;
  poNumber?: string;
  rate: number;
  lines: JobInvoiceLine[];
  discountUSD: number;
  totalUSD: number;
  payments: Payment[];
  changeUSD: number;
  note?: string;
}

/** Kinds of documents the owner can cancel with a reversal (sales use sale_void). */
export const REVERSIBLE_KINDS = ['purchase', 'adjustment', 'count', 'transfer_send', 'transfer_receive', 'transfer_request', 'repayment', 'cash_close', 'issue', 'job_invoice'] as const;
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
  | 'reversal'
  | 'issue'
  | 'issue_return';

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

export type LedgerKind = 'credit_sale' | 'repayment' | 'void' | 'reversal' | 'job_credit';

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
