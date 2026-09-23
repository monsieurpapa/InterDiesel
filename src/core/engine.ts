// The offline-first engine: every write goes to the local database and to an
// outbox in one transaction, then sync() pushes the outbox and pulls what
// changed on the server. Nothing is ever removed from the outbox until the server
// has confirmed it, so a sale made during a power cut or a week without network
// is never lost.
import { ulid } from 'ulid';
import { HLC } from '../../shared/hlc';
import { derive } from '../../shared/derive';
import type { Change, DocKind, EntityKind, Op, PullResponse, PushResult } from '../../shared/types';
import { DOC_KINDS, isDocKind, isEntityKind } from '../../shared/types';
import { LocalDB, getMeta, setMeta, type OutboxItem } from './db';

export interface DeviceInfo {
  deviceId: string;
  deviceCode: string;
  token: string;
  storeId: string | null; // null = owner device for all stores
  serverUrl: string; // '' = same origin
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'revoked';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  rejected: number;
  lastSyncAt: number | null;
  error?: string;
}

type Listener = (s: SyncStatus) => void;

export class Engine {
  device: DeviceInfo | null = null;
  hlc: HLC = new HLC('unenrolled');
  status: SyncStatus = { state: 'idle', pending: 0, rejected: 0, lastSyncAt: null };
  private listeners = new Set<Listener>();
  private syncing: Promise<void> | null = null;
  private again = false;

  constructor(
    public db: LocalDB,
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private isOnline: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    /** The device's own clock (injectable for tests). */
    public clock: () => number = () => Date.now(),
  ) {}

  async init() {
    this.device = await getMeta<DeviceInfo | null>(this.db, 'device', null);
    const offset = await getMeta<number>(this.db, 'clockOffset', 0);
    this.hlc = new HLC(this.device?.deviceCode ?? 'unenrolled', this.clock);
    this.hlc.offset = offset;
    const lastHlc = await getMeta<string | null>(this.db, 'lastHlc', null);
    if (lastHlc) this.hlc.observe(lastHlc);
    this.status.lastSyncAt = await getMeta<number | null>(this.db, 'lastSyncAt', null);
    this.timeFloor = await getMeta<number>(this.db, 'timeFloor', 0);
    await this.refreshCounts();
  }

  /** Latest time known to be true (server time seen, or a document already made). */
  private timeFloor = 0;

  /**
   * Current time corrected by the server clock offset (phones are often wrong),
   * and never earlier than a time already seen: cheap phones reset their date to
   * 2000 or 2010 when the battery dies, and a sale must not be dated then.
   */
  now(): number {
    return Math.max(this.clock() + this.hlc.offset, this.timeFloor);
  }

  onStatus(fn: Listener) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }
  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }
  async refreshCounts() {
    const pending = await this.db.outbox.where('status').equals('pending').count();
    const rejected = await this.db.outbox.where('status').equals('rejected').count();
    this.emit({ pending, rejected });
  }

  async setDevice(d: DeviceInfo) {
    this.device = d;
    const offset = this.hlc.offset;
    this.hlc = new HLC(d.deviceCode, this.clock);
    this.hlc.offset = offset;
    await setMeta(this.db, 'device', d);
  }

  // ---------------- local writes ----------------

  private async tick(): Promise<string> {
    const h = this.hlc.tick();
    await setMeta(this.db, 'lastHlc', h);
    return h;
  }

  /**
   * Create an immutable document (sale, transfer, repayment...). Its effects on
   * stock and customer debt are derived and stored locally as "pending" rows.
   */
  async createDoc<T extends Record<string, any>>(
    kind: DocKind,
    userId: string,
    storeId: string,
    data: Omit<T, 'id' | 'userId' | 'storeId' | 'deviceId' | 'at'> & { id?: string; at?: number },
  ): Promise<T> {
    if (!this.device) throw new Error('device_not_enrolled');
    const doc = { ...data, id: data.id ?? ulid(), userId, storeId, deviceId: this.device.deviceId, at: data.at ?? this.now() } as unknown as T;
    this.timeFloor = Math.max(this.timeFloor, (doc as any).at);
    await setMeta(this.db, 'timeFloor', this.timeFloor);
    const hlc = await this.tick();
    const op: Op = { type: 'doc', opId: doc.id, kind, userId, hlc, data: doc };
    const tables = [this.db.table(kind), this.db.movement, this.db.ledger, this.db.outbox];
    await this.db.transaction('rw', tables, async () => {
      if (await this.db.table(kind).get(doc.id)) throw new Error('duplicate_document');
      await this.db.table(kind).put(doc);
      const { movements, ledger } = derive(kind, doc);
      if (movements.length) await this.db.movement.bulkPut(movements.map((m) => ({ ...m, pending: 1 })));
      if (ledger.length) await this.db.ledger.bulkPut(ledger.map((l) => ({ ...l, pending: 1 })));
      await this.db.outbox.add({ opId: op.opId, op, status: 'pending', createdAt: Date.now(), tries: 0 });
    });
    await this.refreshCounts();
    this.scheduleSync();
    return doc;
  }

  /** Create a sale with a receipt number that is unique for this device. */
  async nextReceiptNo(storeCode: string): Promise<string> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const n = (await getMeta<number>(this.db, 'receiptCounter', 0)) + 1;
      await setMeta(this.db, 'receiptCounter', n);
      return `${storeCode}-${this.device?.deviceCode ?? 'XX'}-${String(n).padStart(4, '0')}`;
    });
  }

  /** Change fields of a mutable record (product, customer...). */
  async patch(kind: EntityKind, id: string, userId: string, fields: Record<string, unknown>) {
    const hlc = await this.tick();
    const op: Op = { type: 'patch', opId: ulid(), kind, id, userId, hlc, fields };
    await this.db.transaction('rw', [this.db.table(kind), this.db.outbox], async () => {
      const cur = (await this.db.table(kind).get(id)) ?? { id };
      await this.db.table(kind).put({ ...cur, ...fields, id });
      await this.db.outbox.add({ opId: op.opId, op, status: 'pending', createdAt: Date.now(), tries: 0 });
    });
    await this.refreshCounts();
    this.scheduleSync();
  }

  // ---------------- sync ----------------

  private timer: any = null;
  scheduleSync(delay = 1500) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sync().catch(() => {});
    }, delay);
  }

  /** Push pending operations, then pull changes. Safe to call at any time. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
      if (this.again) {
        this.again = false;
        this.scheduleSync(200);
      }
    });
    return this.syncing;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const d = this.device!;
    const res = await this.fetchImpl(`${d.serverUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (res.status === 401) throw new HttpError(401, 'device_not_enrolled');
    if (!res.ok) throw new HttpError(res.status, `http_${res.status}`);
    return (await res.json()) as T;
  }

  private async runSync() {
    if (!this.device) return;
    if (!this.isOnline()) {
      this.emit({ state: 'offline' });
      return;
    }
    this.emit({ state: 'syncing', error: undefined });
    try {
      // 1. push, in creation order, in batches (max 200 ops or ~1.5 MB per request)
      const acked: OutboxItem[] = [];
      let serverTrouble = false;
      let cursor = 0;
      for (;;) {
        const candidates = await this.db.outbox.where(':id').above(cursor).limit(400).toArray();
        if (!candidates.length) break;
        const batch: OutboxItem[] = [];
        let size = 0;
        for (const c of candidates) {
          const n = c.status === 'pending' ? JSON.stringify(c.op).length : 0;
          if (batch.length && (batch.length >= 200 || size + n > 1_500_000)) break;
          cursor = c.seq!;
          if (c.status === 'pending') {
            batch.push(c);
            size += n;
          }
        }
        if (!batch.length) continue;
        const { results, serverTime } = await this.api<{ results: PushResult[]; serverTime: number }>('/api/sync/push', {
          method: 'POST',
          body: JSON.stringify({ ops: batch.map((b) => b.op) }),
        });
        this.learnTime(serverTime);
        const byId = new Map(results.map((r) => [r.opId, r]));
        await this.db.transaction('rw', this.db.outbox, async () => {
          for (const item of batch) {
            const r = byId.get(item.opId);
            if (!r) continue;
            if (r.status === 'ok' || r.status === 'duplicate') acked.push(item);
            else if (r.status === 'rejected') await this.db.outbox.update(item.seq!, { status: 'rejected', error: r.error, tries: item.tries + 1 });
            else serverTrouble = true; // server error: stays pending, sent again next time
          }
        });
      }

      // 2. pull everything new
      let since = await getMeta<number>(this.db, 'pullSeq', 0);
      const changes: Change[] = [];
      for (;;) {
        const page = await this.api<PullResponse>(`/api/sync/pull?since=${since}`);
        this.learnTime(page.serverTime);
        const known = await getMeta<string | null>(this.db, 'epoch', null);
        if (page.epoch && known !== page.epoch) {
          if (known) {
            // The server was restored from a backup: re-send what this device made, download again.
            await this.recoverFromRestore(page.epoch, acked);
            this.again = true;
            return;
          }
          await setMeta(this.db, 'epoch', page.epoch);
        }
        changes.push(...page.changes);
        since = page.nextSeq;
        if (!page.more) break;
        if (changes.length >= 20_000) {
          // apply big initial syncs in chunks to keep memory low on small phones
          await this.applyPulled(changes.splice(0), [], since);
        }
      }

      // 3. apply pulled rows and clear confirmed ops in one transaction
      await this.applyPulled(changes, acked, since);
      const at = Date.now();
      await setMeta(this.db, 'lastSyncAt', at);
      await this.refreshCounts();
      this.emit(serverTrouble ? { state: 'error', error: 'server_error', lastSyncAt: at } : { state: 'idle', lastSyncAt: at });
    } catch (e) {
      const err = e as Error;
      if (err instanceof HttpError && err.status === 401) this.emit({ state: 'revoked', error: err.message });
      else this.emit({ state: this.isOnline() ? 'error' : 'offline', error: err.message });
      await this.refreshCounts();
      throw e;
    }
  }

  private learnTime(serverTime: number) {
    if (!serverTime) return;
    if (serverTime > this.timeFloor) {
      this.timeFloor = serverTime;
      setMeta(this.db, 'timeFloor', serverTime).catch(() => {});
    }
    const offset = serverTime - this.clock();
    // ignore small differences (network latency); correct phones that are minutes or days off
    if (Math.abs(offset - this.hlc.offset) > 30_000) {
      this.hlc.offset = offset;
      setMeta(this.db, 'clockOffset', offset).catch(() => {});
    }
  }

  private async applyPulled(changes: Change[], acked: OutboxItem[], since: number) {
    const tables = new Set<string>(['outbox', 'meta', 'movement', 'ledger']);
    for (const c of changes) tables.add(c.kind);
    await this.db.transaction('rw', [...tables].map((t) => this.db.table(t)), async () => {
      // Local edits not yet confirmed stay visible on top of the server version.
      const pendingPatches = new Map<string, Record<string, unknown>[]>();
      const pending = await this.db.outbox.where('status').equals('pending').toArray();
      const ackedIds = new Set(acked.map((a) => a.opId));
      for (const p of pending) {
        if (p.op.type !== 'patch' || ackedIds.has(p.opId)) continue;
        const key = `${p.op.kind}:${p.op.id}`;
        pendingPatches.set(key, [...(pendingPatches.get(key) ?? []), p.op.fields]);
      }
      const byKind = new Map<string, any[]>();
      for (const c of changes) {
        let row: any = c.data;
        if (isEntityKind(c.kind)) {
          for (const f of pendingPatches.get(`${c.kind}:${c.id}`) ?? []) row = { ...row, ...f };
        } else if (c.kind === 'movement' || c.kind === 'ledger') {
          row = { ...row, pending: 0 };
        }
        const arr = byKind.get(c.kind) ?? [];
        arr.push(row);
        byKind.set(c.kind, arr);
      }
      for (const [kind, rows] of byKind) await this.db.table(kind).bulkPut(rows);

      // Confirmed documents: their stock and debt effects are now in the server's numbers.
      const docIds = acked.filter((a) => a.op.type === 'doc').map((a) => a.opId);
      if (docIds.length) {
        const movs = await this.db.movement.where('ref').anyOf(docIds).toArray();
        const scope = this.device?.storeId;
        for (const m of movs) {
          // A store device does not receive other stores' movements; drop the local copy.
          if (scope && m.storeId !== scope) await this.db.movement.delete(m.id);
          else await this.db.movement.update(m.id, { pending: 0 });
        }
        await this.db.ledger.where('ref').anyOf(docIds).modify({ pending: 0 });
      }
      if (acked.length) await this.db.outbox.bulkDelete(acked.map((a) => a.seq!));
      await setMeta(this.db, 'pullSeq', since);
    });
  }

  /**
   * The server database was restored from a backup (its epoch changed). Everything
   * this device made may be missing there, so: keep this device's own documents and
   * the unsent queue, clear what came from the server, queue the device's documents
   * again (the server ignores the ones it still has), and download everything again.
   */
  private async recoverFromRestore(epoch: string, acked: OutboxItem[]) {
    const me = this.device!.deviceId;
    const own: { kind: DocKind; doc: any }[] = [];
    for (const kind of DOC_KINDS) {
      for (const d of await this.db.table(kind).toArray()) if (d.deviceId === me) own.push({ kind, doc: d });
    }
    own.sort((a, b) => a.doc.at - b.doc.at);
    const ackedIds = new Set(acked.map((a) => a.opId));
    await this.db.transaction('rw', this.db.tables, async () => {
      const queue = (await this.db.outbox.toArray()).filter((i) => !ackedIds.has(i.opId));
      const queued = new Set(queue.map((i) => i.opId));
      for (const t of this.db.tables) if (t.name !== 'meta') await t.clear();
      const putDoc = async (kind: DocKind, doc: any) => {
        await this.db.table(kind).put(doc);
        const { movements, ledger } = derive(kind, doc);
        if (movements.length) await this.db.movement.bulkPut(movements.map((m) => ({ ...m, pending: 1 })));
        if (ledger.length) await this.db.ledger.bulkPut(ledger.map((l) => ({ ...l, pending: 1 })));
      };
      for (const { kind, doc } of own) {
        await putDoc(kind, doc);
        if (queued.has(doc.id)) continue;
        const op: Op = { type: 'doc', opId: doc.id, kind, userId: doc.userId, hlc: this.hlc.tick(), data: doc };
        await this.db.outbox.add({ opId: op.opId, op, status: 'pending', createdAt: Date.now(), tries: 0 });
      }
      for (const item of queue) {
        const { seq, ...rest } = item;
        await this.db.outbox.add({ ...rest, status: 'pending', error: undefined });
      }
      await setMeta(this.db, 'pullSeq', 0);
      await setMeta(this.db, 'epoch', epoch);
    });
    await this.refreshCounts();
  }

  /** Put a rejected operation back in the queue (e.g. after the owner fixed a user). */
  async retry(seq: number) {
    await this.db.outbox.update(seq, { status: 'pending', error: undefined });
    await this.refreshCounts();
    this.scheduleSync(100);
  }

  /** Give up on a rejected operation and remove its local effects. */
  async discard(seq: number) {
    const item = await this.db.outbox.get(seq);
    if (!item) return;
    await this.db.transaction('rw', [this.db.outbox, this.db.movement, this.db.ledger, this.db.table(item.op.kind)], async () => {
      if (item.op.type === 'doc' && isDocKind(item.op.kind)) {
        await this.db.table(item.op.kind).delete(item.opId);
        await this.db.movement.where('ref').equals(item.opId).delete();
        await this.db.ledger.where('ref').equals(item.opId).delete();
      }
      await this.db.outbox.delete(seq);
    });
    await setMeta(this.db, 'pullSeq', 0); // re-pull to restore the server's version of edited records
    await this.refreshCounts();
    this.scheduleSync(100);
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
