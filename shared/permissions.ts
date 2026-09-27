import type { DocKind, EntityKind, Role } from './types';

export type Action =
  | 'sell'
  | 'sale.void'
  | 'repay'
  | 'customer.edit'
  | 'product.edit'
  | 'price.edit'
  | 'minstock.edit'
  | 'supplier.edit'
  | 'purchase'
  | 'adjust'
  | 'count'
  | 'transfer.request'
  | 'transfer.send'
  | 'transfer.receive'
  | 'cash.close'
  | 'rate.set'
  | 'alert.resolve'
  | 'report.view'
  | 'report.allStores'
  | 'audit.view'
  | 'user.manage'
  | 'store.manage'
  | 'device.manage'
  | 'doc.reverse'
  // garage
  | 'job.create' // register a vehicle arrival
  | 'job.work' // checklist, diagnosis, parts needed, progress, photos
  | 'job.price' // labour prices, discounts, quote approval
  | 'job.invoice' // invoice and take payment
  | 'issue.create' // hand parts out on a bon de sortie
  | 'vehicle.edit'
  | 'service.manage';

const SELLER: Action[] = ['sell', 'repay', 'customer.edit', 'transfer.request', 'job.create', 'job.work', 'job.invoice', 'issue.create', 'vehicle.edit'];
/** Mechanics work on jobs; they do not sell, price or take money. */
const MECHANIC: Action[] = ['job.create', 'job.work', 'issue.create', 'vehicle.edit', 'transfer.request'];
const MANAGER: Action[] = [
  ...SELLER,
  'sale.void',
  'product.edit',
  'price.edit',
  'minstock.edit',
  'supplier.edit',
  'purchase',
  'adjust',
  'count',
  'transfer.send',
  'transfer.receive',
  'cash.close',
  'rate.set',
  'alert.resolve',
  'report.view',
  'audit.view',
  'job.price',
  'service.manage',
];

const MATRIX: Record<Role, Set<Action>> = {
  seller: new Set(SELLER),
  mechanic: new Set(MECHANIC),
  manager: new Set(MANAGER),
  owner: new Set<Action>([...MANAGER, 'report.allStores', 'user.manage', 'store.manage', 'device.manage', 'doc.reverse']),
};

export function can(role: Role | undefined | null, action: Action): boolean {
  return !!role && MATRIX[role].has(action);
}

export const DOC_ACTION: Record<DocKind, Action> = {
  sale: 'sell',
  sale_void: 'sale.void',
  repayment: 'repay',
  purchase: 'purchase',
  adjustment: 'adjust',
  count: 'count',
  transfer_request: 'transfer.request',
  transfer_send: 'transfer.send',
  transfer_receive: 'transfer.receive',
  cash_close: 'cash.close',
  rate: 'rate.set',
  reversal: 'doc.reverse',
  issue: 'issue.create',
  job_invoice: 'job.invoice',
};

/** Job fields that are money decisions (garage chief only). */
export const JOB_PRICE_FIELDS = ['labour', 'approvedTotalUSD', 'approvedAt', 'approvedBy', 'approvedVia', 'quoteSentAt'];

/** Which action a patch needs. Price and cost changes need price.edit. */
export function patchAction(kind: EntityKind, fields: Record<string, unknown>): Action {
  switch (kind) {
    case 'product':
      return 'priceUSD' in fields || 'priceCDF' in fields || 'costUSD' in fields ? 'price.edit' : 'product.edit';
    case 'photo':
      return 'product.edit';
    case 'vehicle':
      return 'vehicle.edit';
    case 'service':
      return 'service.manage';
    case 'job':
      return Object.keys(fields).some((k) => JOB_PRICE_FIELDS.includes(k)) ? 'job.price' : 'job.work';
    case 'customer':
      // the credit limit is a money decision: managers only
      return 'creditLimitUSD' in fields ? 'price.edit' : 'customer.edit';
    case 'supplier':
      return 'supplier.edit';
    case 'minstock':
      return 'minstock.edit';
    case 'alert':
      return 'alert.resolve';
    case 'user':
      return 'user.manage';
    case 'store':
      return 'store.manage';
  }
}
