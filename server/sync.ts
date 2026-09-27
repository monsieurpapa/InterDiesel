// Applies operations pushed by devices and serves changes back to them.
// Every op is applied inside one SQLite transaction together with its effects
// (movements, stock levels, debt ledger, audit, alerts), so the server state is
// always consistent even if the process dies mid-sync.

import { derive, docScope, inverseOf, receiveIdFor, reversalIdFor, stockId, voidIdFor } from '../shared/derive';
import { applyPatch } from '../shared/merge';
import { can, DOC_ACTION, patchAction } from '../shared/permissions';
import { validateDoc, validatePatch } from '../shared/schemas';
import { isHlc, HLC, parse as parseHlc } from '../shared/hlc';
import { creditOf } from '../shared/derive';
import { fmtUSD } from '../shared/money';
import type { Alert, AuditEntry, Change, DocKind, EntityKind, Op, PullResponse, PushResult, Role, User } from '../shared/types';
import { isDocKind, isEntityKind } from '../shared/types';
import { getEpoch, getRecord, insertRecord, putRecord, type DB } from './db';

export interface Device {
  id: string;
  code: string;
  scope: string | null; // null = all stores
}

const serverClock = new HLC('server');
/** Scope used for records only the owner's all-store devices should see. */
export const OWNER_SCOPE = '__owner';
/** Clocks more than this far ahead of the server are not trusted. */
const MAX_FUTURE_MS = 5 * 60_000;

class Rejected extends Error {}

/**
 * Applies pushed operations in order. Result per op:
 *  - ok / duplicate: the server has it (the device may forget it)
 *  - rejected: refused for a reason that will not change by itself; the device keeps it
 *  - error: server problem; the device keeps it pending and tries again later
 * Only applied operations are remembered, so a rejected op can be retried after the
 * cause is fixed, and nobody can "squat" an id by sending garbage with it first.
 */
export function pushOps(db: DB, device: Device, ops: Op[]): PushResult[] {
  const results: PushResult[] = [];
  for (const op of ops) {
    if (op?.type === 'patch' && typeof op.opId === 'string') {
      const seen = db.prepare("SELECT 1 FROM oplog WHERE op_id = ? AND device_id = ? AND status = 'ok'").get(op.opId, device.id);
      if (seen) {
        results.push({ opId: op.opId, status: 'duplicate' });
        continue;
      }
    }
    let status: PushResult['status'] = 'ok';
    let error: string | undefined;
    try {
      const r = db.transaction(() => applyOp(db, device, op))();
      if (r === 'duplicate') status = 'duplicate';
    } catch (e) {
      if (e instanceof Rejected) {
        status = 'rejected';
        error = e.message;
      } else {
        console.error('op failed', op?.opId, e);
        status = 'error';
        error = 'server_error';
      }
    }
    const opId = typeof op?.opId === 'string' ? op.opId.slice(0, 80) : '';
    if (status === 'ok') {
      db.prepare(
        'INSERT OR IGNORE INTO oplog(op_id, device_id, user_id, kind, status, error, received_at, body) VALUES (?,?,?,?,?,?,?,?)',
      ).run(opId, device.id, String(op.userId ?? ''), String(op.kind ?? ''), 'ok', null, Date.now(), JSON.stringify(op).slice(0, 200_000));
    } else if (status === 'rejected') {
      db.prepare('INSERT INTO rejections(op_id, device_id, kind, error, at, body) VALUES (?,?,?,?,?,?)').run(
        opId,
        device.id,
        String(op?.kind ?? ''),
        error ?? null,
        Date.now(),
        JSON.stringify(op ?? null).slice(0, 200_000),
      );
      if (opId) {
        raiseAlert(db, {
          id: `rej_${device.id}_${opId}`.slice(0, 80),
          storeId: device.scope,
          type: 'rejected_op',
          ref: opId,
          message: `${String(op?.kind ?? '')}: ${error}`,
          at: Date.now(),
          resolved: false,
        });
      }
    }
    results.push({ opId: op?.opId, status, error });
  }
  return results;
}

function getUser(db: DB, userId: string): User | null {
  return (getRecord(db, 'user', userId)?.data as User) ?? null;
}

/**
 * On a device enrolled for one store, the owner acts as a manager of that store.
 * PINs are only checked on the device, so a store device must never carry owner rights
 * (managing users, stores, or other stores): those need the owner's all-store device.
 */
function actorFor(user: User, device: Device): User {
  if (device.scope && user.role === 'owner') return { ...user, role: 'manager', storeId: device.scope };
  return user;
}

function applyOp(db: DB, device: Device, op: Op): 'ok' | 'duplicate' {
  if (!op || typeof op !== 'object') throw new Rejected('bad_op');
  if (typeof op.opId !== 'string' || !/^[A-Za-z0-9_:\-]{1,80}$/.test(op.opId)) throw new Rejected('bad_op_id');
  if (!isHlc(op.hlc)) throw new Rejected('bad_hlc');
  // A clock far in the future would win every later edit: use the server's clock instead.
  let hlc = op.hlc;
  if (parseHlc(op.hlc)!.ms > Date.now() + MAX_FUTURE_MS) hlc = serverClock.tick();
  else serverClock.observe(op.hlc);
  const user = getUser(db, op.userId);
  if (!user) throw new Rejected('unknown_user');
  // A device enrolled for one store can only act as users of that store (or the owner).
  if (device.scope && user.role !== 'owner' && user.storeId !== device.scope) throw new Rejected('user_not_in_device_store');
  const actor = actorFor(user, device);

  if (op.type === 'doc') return applyDoc(db, device, actor, op.kind, op.data, op.opId);
  if (op.type === 'patch') {
    applyEntityPatch(db, device, actor, op.kind, op.id, op.fields, hlc);
    return 'ok';
  }
  throw new Rejected('bad_op_type');
}

function applyDoc(db: DB, device: Device, user: User, kind: DocKind, raw: any, opId: string): 'ok' | 'duplicate' {
  if (!isDocKind(kind)) throw new Rejected('bad_kind');
  // Already applied? Checked first, so a resend is confirmed even if rights changed since.
  const existing = getRecord(db, kind, opId);
  if (existing) {
    if (existing.data.deviceId === device.id) return 'duplicate';
    throw new Rejected('id_taken');
  }
  if (
    (opId.startsWith('void_') && kind !== 'sale_void') ||
    (opId.startsWith('recv_') && kind !== 'transfer_receive') ||
    (opId.startsWith('rev_') && kind !== 'reversal')
  )
    throw new Rejected('reserved_id');
  const v = validateDoc(kind, raw);
  if (!v.ok) throw new Rejected(`invalid:${v.error}`);
  const d = v.data;
  if (d.id !== opId) throw new Rejected('id_mismatch');
  if (d.userId !== user.id) throw new Rejected('user_mismatch');
  if (d.deviceId !== device.id) throw new Rejected('device_mismatch');
  if (!can(user.role, DOC_ACTION[kind])) throw new Rejected('forbidden');
  if (!getRecord(db, 'store', d.storeId)) throw new Rejected('unknown_store');
  // Store checks: the device and the user must belong to the store of the document.
  if (device.scope && d.storeId !== device.scope) throw new Rejected('wrong_store_for_device');
  if (user.role !== 'owner' && user.storeId !== d.storeId) throw new Rejected('wrong_store_for_user');

  // A phone clock far ahead must not put the document in the future.
  if (d.at > Date.now() + 10 * 60_000) d.at = Date.now();
  // Every product referenced must exist.
  const pids: string[] = d.productId ? [d.productId] : (d.lines ?? []).map((l: any) => l.productId).filter(Boolean);
  for (const pid of pids) if (!getRecord(db, 'product', pid)) throw new Rejected('unknown_product');

  // Kind-specific integrity rules. The server trusts its own copy of referenced docs.
  switch (kind) {
    case 'sale_void': {
      if (d.id !== voidIdFor(d.saleId)) throw new Rejected('void_id');
      const sale = getRecord(db, 'sale', d.saleId)?.data;
      if (!sale) throw new Rejected('unknown_sale');
      if (sale.storeId !== d.storeId) throw new Rejected('void_wrong_store');
      d.lines = sale.lines.map((l: any) => ({ productId: l.productId, qty: l.qty }));
      d.customerId = sale.customerId ?? null;
      d.creditUSD = creditOf(sale);
      break;
    }
    case 'transfer_send':
      if (d.toStoreId === d.storeId) throw new Rejected('same_store');
      if (!getRecord(db, 'store', d.toStoreId)) throw new Rejected('unknown_store');
      break;
    case 'transfer_request':
      if (d.fromStoreId === d.storeId) throw new Rejected('same_store');
      break;
    case 'reversal': {
      if (d.id !== reversalIdFor(d.refId)) throw new Rejected('reversal_id');
      const ref = getRecord(db, d.refKind, d.refId)?.data;
      if (!ref) throw new Rejected('unknown_document');
      if (ref.storeId !== d.storeId) throw new Rejected('wrong_store_for_device');
      if (d.refKind === 'transfer_send') {
        const recv = receiveIdFor(d.refId);
        if (getRecord(db, 'transfer_receive', recv) && !getRecord(db, 'reversal', reversalIdFor(recv))) throw new Rejected('transfer_already_received');
      }
      // The server trusts its own copy of the original, not what the device computed.
      Object.assign(d, inverseOf(d.refKind, ref));
      break;
    }
    case 'transfer_receive': {
      if (d.id !== receiveIdFor(d.sendId)) throw new Rejected('receive_id');
      if (getRecord(db, 'reversal', reversalIdFor(d.sendId))) throw new Rejected('transfer_cancelled');
      const send = getRecord(db, 'transfer_send', d.sendId)?.data;
      if (!send) throw new Rejected('unknown_transfer');
      if (send.toStoreId !== d.storeId || send.storeId !== d.fromStoreId) throw new Rejected('transfer_store_mismatch');
      const sent = new Map<string, number>(send.lines.map((l: any) => [l.productId, l.qty]));
      for (const l of d.lines) if (!sent.has(l.productId)) throw new Rejected('transfer_unknown_line');
      for (const [pid, q] of sent) {
        const got = d.lines.find((l: any) => l.productId === pid)?.qty ?? 0;
        if (got !== q) {
          raiseAlert(db, { id: `gap_${d.id}_${pid}`.slice(0, 80), storeId: d.storeId, type: 'transfer_gap', productId: pid, qty: got - q, ref: d.sendId, at: d.at, resolved: false });
          raiseAlert(db, { id: `gapf_${d.id}_${pid}`.slice(0, 80), storeId: d.fromStoreId, type: 'transfer_gap', productId: pid, qty: got - q, ref: d.sendId, at: d.at, resolved: false });
        }
      }
      break;
    }
    case 'repayment':
    case 'sale':
      if (d.customerId && !getRecord(db, 'customer', d.customerId)) throw new Rejected('unknown_customer');
      break;
    case 'issue': {
      const job = getRecord(db, 'job', d.jobId)?.data;
      if (!job) throw new Rejected('unknown_job');
      const store = getRecord(db, 'store', d.storeId)?.data;
      // a garage hands out only its own shelf, for its own jobs
      if (store?.kind === 'garage' && job.storeId !== d.storeId) throw new Rejected('wrong_store_for_job');
      if (d.returned) {
        // parts can only come back to the store they left, up to what left
        const net = issuedForJob(db, d.jobId, d.storeId);
        for (const l of d.lines) if ((net.get(l.productId) ?? 0) < l.qty) throw new Rejected('return_more_than_issued');
      }
      break;
    }
    case 'job_invoice': {
      const job = getRecord(db, 'job', d.jobId)?.data;
      if (!job) throw new Rejected('unknown_job');
      if (job.storeId !== d.storeId) throw new Rejected('wrong_store_for_job');
      if (d.customerId && !getRecord(db, 'customer', d.customerId)) throw new Rejected('unknown_customer');
      const customer = d.customerId ? getRecord(db, 'customer', d.customerId)?.data : null;
      if (customer?.poRequired && !String(d.poNumber ?? '').trim()) throw new Rejected('po_required');
      const open = db
        .prepare("SELECT id FROM records WHERE kind = 'job_invoice' AND json_extract(data, '$.jobId') = ?")
        .all(d.jobId)
        .some((r: any) => !getRecord(db, 'reversal', reversalIdFor(r.id)));
      if (open) throw new Rejected('job_already_invoiced');
      break;
    }
  }

  // Sales made by a user who was deactivated while the device was offline are kept
  // (never lose a sale) but flagged for the owner.
  if (!user.active) {
    raiseAlert(db, { id: `inact_${d.id}`.slice(0, 80), storeId: d.storeId, type: 'inactive_user', ref: d.id, message: user.name, at: d.at, resolved: false });
  }

  insertRecord(db, kind, d.id, docScope(kind, d), d);
  const { movements, ledger } = derive(kind, d);
  for (const m of movements) {
    if (!insertRecord(db, 'movement', m.id, m.storeId, m)) continue;
    const sid = stockId(m.storeId, m.productId);
    const cur = getRecord(db, 'stock', sid)?.data ?? { id: sid, storeId: m.storeId, productId: m.productId, qty: 0 };
    cur.qty += m.qty;
    putRecord(db, 'stock', sid, null, cur);
    if (cur.qty < 0) {
      raiseAlert(db, { id: `neg_${sid}`, storeId: m.storeId, type: 'negative_stock', productId: m.productId, qty: cur.qty, ref: d.id, at: d.at, resolved: false }, true);
    }
  }
  for (const l of ledger) insertRecord(db, 'ledger', l.id, null, l);
  if (kind === 'count') {
    const gaps = d.lines.filter((l: any) => l.counted !== l.expected).length;
    if (gaps) raiseAlert(db, { id: `cnt_${d.id}`.slice(0, 80), storeId: d.storeId, type: 'count_gap', qty: gaps, ref: d.id, at: d.at, resolved: false });
  }
  audit(db, device, user, { storeId: d.storeId, kind, refId: d.id, at: d.at, summary: docSummary(kind, d) });
  return 'ok';
}

/** Net quantity of each product a store handed out for a job (issued - returned, reversals excluded). */
export function issuedForJob(db: DB, jobId: string, storeId?: string): Map<string, number> {
  const rows = db.prepare("SELECT data FROM records WHERE kind = 'issue' AND json_extract(data, '$.jobId') = ?").all(jobId) as any[];
  const net = new Map<string, number>();
  for (const r of rows) {
    const x = JSON.parse(r.data);
    if (storeId && x.storeId !== storeId) continue;
    if (getRecord(db, 'reversal', reversalIdFor(x.id))) continue;
    for (const l of x.lines) net.set(l.productId, (net.get(l.productId) ?? 0) + (x.returned ? -l.qty : l.qty));
  }
  return net;
}

function docSummary(kind: DocKind, d: any): string {
  switch (kind) {
    case 'issue':
      return `${d.no} · ${d.jobNo}${d.returned ? ' · retour' : ''}`;
    case 'job_invoice':
      return `${d.no} · ${d.jobNo} · ${fmtUSD(d.totalUSD)}`;
    case 'sale':
      return `${d.no} · ${fmtUSD(d.totalUSD)}`;
    case 'sale_void':
      return `${d.saleNo} · ${d.reason}`;
    case 'repayment':
      return fmtUSD(d.amountUSD);
    case 'purchase':
      return `${d.lines.length} · ${fmtUSD(d.totalUSD)}`;
    case 'adjustment':
      return `${d.qty > 0 ? '+' : ''}${d.qty} · ${d.reason}`;
    case 'rate':
      return `${d.cdfPerUsd}`;
    case 'reversal':
      return `${d.refKind} · ${d.reason}`;
    default:
      return String(d.lines?.length ?? '');
  }
}

function applyEntityPatch(db: DB, device: Device, user: User, kind: EntityKind, id: string, rawFields: any, hlc: string) {
  if (!isEntityKind(kind)) throw new Rejected('bad_kind');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_:\-]{1,80}$/.test(id)) throw new Rejected('bad_id');
  const v = validatePatch(kind, rawFields);
  if (!v.ok) throw new Rejected(`invalid:${v.error}`);
  const fields = v.data as Record<string, unknown>;
  if (Object.keys(fields).length === 0) throw new Rejected('empty_patch');

  const existing = getRecord(db, kind, id);

  // Permissions. A user may change their own PIN; everything else follows the matrix.
  // (not the owner's PIN from a store device: there the owner only acts as that store's manager)
  const ownPin = kind === 'user' && id === user.id && existing?.data.role === user.role && Object.keys(fields).every((k) => k === 'pinHash');
  // job photos are taken by whoever registers or works on the job
  const action = kind === 'photo' && id.startsWith('job_') ? 'job.work' : patchAction(kind, fields);
  if (!ownPin && !can(user.role, action)) throw new Rejected('forbidden');
  if (kind === 'job') {
    const storeId = (existing?.data.storeId ?? fields.storeId) as string;
    if (existing && 'storeId' in fields && fields.storeId !== existing.data.storeId) throw new Rejected('job_store_fixed');
    if (getRecord(db, 'store', storeId)?.data.kind !== 'garage') throw new Rejected('not_a_garage');
    if (user.role !== 'owner' && user.storeId !== storeId) throw new Rejected('wrong_store_for_user');
    if (!existing && (!fields.vehicleId || !fields.no || !fields.status)) throw new Rejected('job_incomplete');
    if (fields.vehicleId && !getRecord(db, 'vehicle', fields.vehicleId as string)) throw new Rejected('unknown_vehicle');
  }
  if (kind === 'vehicle' && !existing && !fields.plate) throw new Rejected('plate_required');
  if (kind === 'user' && 'role' in fields && fields.role === 'owner' && user.role !== 'owner') throw new Rejected('forbidden');
  if (kind === 'user' && 'username' in fields) throw new Rejected('username_via_api_only');
  if (kind === 'minstock') {
    const storeId = (fields.storeId ?? existing?.data.storeId) as string;
    if (id !== stockId(storeId, (fields.productId ?? existing?.data.productId) as string)) throw new Rejected('minstock_id');
    if (user.role !== 'owner' && storeId !== user.storeId) throw new Rejected('wrong_store_for_user');
  }
  if (kind === 'alert') {
    if (!existing) throw new Rejected('unknown_alert');
    if (user.role !== 'owner' && existing.data.storeId && existing.data.storeId !== user.storeId) throw new Rejected('wrong_store_for_user');
  }
  if (!existing && (kind === 'product' || kind === 'customer' || kind === 'supplier' || kind === 'service') && !fields.name) throw new Rejected('name_required');

  const base = existing?.data ?? { id };
  const merged = applyPatch(base, existing?.clocks ?? {}, fields, hlc);
  if (!existing || Object.keys(merged.changed).length) {
    const scope = kind === 'alert' ? existing?.scope ?? null : null;
    putRecord(db, kind, id, scope, merged.data, merged.clocks);
  } else if (existing) {
    // Nothing won (older write): still keep the merged clocks unchanged.
    return;
  }
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, pair] of Object.entries(merged.changed)) changes[k] = k === 'pinHash' ? ['•', '•'] : pair;
  if (kind !== 'photo') {
    audit(db, device, user, {
      storeId: kind === 'minstock' ? (merged.data.storeId as string) : device.scope ?? OWNER_SCOPE,
      kind: `${kind}.${existing ? 'edit' : 'create'}`,
      refId: id,
      at: Date.now(),
      summary: String(merged.data.name ?? merged.data.plate ?? merged.data.no ?? merged.data.ref ?? id),
      changes,
    });
  }
}

let auditCounter = 0;
function audit(db: DB, device: Device, user: User, e: Omit<AuditEntry, 'id' | 'userId' | 'deviceId'>) {
  const id = `au_${Date.now().toString(36)}_${(auditCounter++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const entry: AuditEntry = { id, userId: user.id, deviceId: device.id, ...e };
  insertRecord(db, 'audit', id, e.storeId, entry);
}

export function raiseAlert(db: DB, a: Alert, refresh = false) {
  const existing = getRecord(db, 'alert', a.id);
  if (existing && !refresh) return;
  if (existing && refresh && existing.data.resolved === false && existing.data.qty === a.qty) return;
  const hlc = serverClock.tick();
  const fields: Record<string, unknown> = { ...a };
  const merged = applyPatch(existing?.data ?? { id: a.id }, existing?.clocks ?? {}, fields, hlc);
  const scope = a.storeId ?? (a.type === 'rejected_op' ? OWNER_SCOPE : null);
  putRecord(db, 'alert', a.id, scope, merged.data, merged.clocks);
}

// ---------- Pull ----------

export function pull(db: DB, device: Device, since: number, limit = 1000): PullResponse {
  const rows = (
    device.scope
      ? db
          .prepare('SELECT kind, id, seq, data FROM records WHERE seq > ? AND (scope IS NULL OR scope = ?) ORDER BY seq LIMIT ?')
          .all(since, device.scope, limit + 1)
      : db.prepare('SELECT kind, id, seq, data FROM records WHERE seq > ? ORDER BY seq LIMIT ?').all(since, limit + 1)
  ) as any[];
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const changes: Change[] = page.map((r) => ({ seq: r.seq, kind: r.kind, id: r.id, data: JSON.parse(r.data) }));
  const nextSeq = page.length ? page[page.length - 1].seq : since;
  return { changes, nextSeq, more, serverTime: Date.now(), epoch: getEpoch(db) };
}

export function roleOf(db: DB, userId: string): Role | null {
  return getUser(db, userId)?.role ?? null;
}
