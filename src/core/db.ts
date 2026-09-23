// Local database on the device (IndexedDB via Dexie). Every screen reads from
// here, so the app works the same online and offline.
import Dexie, { type Table } from 'dexie';
import type { Op } from '../../shared/types';

export interface OutboxItem {
  seq?: number;
  opId: string;
  op: Op;
  status: 'pending' | 'rejected';
  error?: string;
  createdAt: number;
  tries: number;
}

export interface MetaRow {
  key: string;
  value: any;
}

export class LocalDB extends Dexie {
  store!: Table<any, string>;
  user!: Table<any, string>;
  product!: Table<any, string>;
  customer!: Table<any, string>;
  supplier!: Table<any, string>;
  minstock!: Table<any, string>;
  photo!: Table<any, string>;
  alert!: Table<any, string>;
  sale!: Table<any, string>;
  sale_void!: Table<any, string>;
  repayment!: Table<any, string>;
  purchase!: Table<any, string>;
  adjustment!: Table<any, string>;
  count!: Table<any, string>;
  transfer_request!: Table<any, string>;
  transfer_send!: Table<any, string>;
  transfer_receive!: Table<any, string>;
  cash_close!: Table<any, string>;
  rate!: Table<any, string>;
  movement!: Table<any, string>;
  stock!: Table<any, string>;
  ledger!: Table<any, string>;
  audit!: Table<any, string>;
  outbox!: Table<OutboxItem, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'interdiesel') {
    super(name);
    this.version(1).stores({
      store: 'id',
      user: 'id, storeId',
      product: 'id, ref, barcode, category',
      customer: 'id, name',
      supplier: 'id',
      minstock: 'id, storeId, productId',
      photo: 'id',
      alert: 'id, storeId, resolved',
      sale: 'id, at, storeId, customerId, [storeId+at]',
      sale_void: 'id, saleId, at, storeId',
      repayment: 'id, at, storeId, customerId',
      purchase: 'id, at, storeId, supplierId',
      adjustment: 'id, at, storeId, productId',
      count: 'id, at, storeId',
      transfer_request: 'id, at, storeId, fromStoreId',
      transfer_send: 'id, at, storeId, toStoreId, requestId',
      transfer_receive: 'id, at, storeId, sendId',
      cash_close: 'id, at, storeId, day',
      rate: 'id, at',
      movement: 'id, storeId, productId, at, pending, ref, [storeId+productId]',
      stock: 'id, storeId, productId',
      ledger: 'id, customerId, pending, ref',
      audit: 'id, at, storeId',
      outbox: '++seq, opId, status',
      meta: 'key',
    });
  }
}

export async function getMeta<T = any>(db: LocalDB, key: string, fallback?: T): Promise<T> {
  const r = await db.meta.get(key);
  return (r?.value ?? fallback) as T;
}
export async function setMeta(db: LocalDB, key: string, value: unknown) {
  await db.meta.put({ key, value });
}
