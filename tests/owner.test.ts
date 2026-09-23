// The owner can cancel any operation (reversal) and create the default team.
import { describe, expect, it } from 'vitest';
import { localStock, makeServer } from './helpers';
import { getRecord } from '../server/db';
import { pushOps } from '../server/sync';
import { createStaff, STAFF } from '../server/seed';
import { customerBalances } from '../shared/reports';
import { inverseOf, receiveIdFor, reversalIdFor } from '../shared/derive';

describe('owner reversals', () => {
  it('cancels a purchase on the owner device: stock goes back, history is kept', async () => {
    const s = await makeServer();
    const owner = await s.device('owner', 'owner-password', null);
    const po = await owner.engine.createDoc('purchase', 'u_owner', s.A.id, { supplierId: null, lines: [{ productId: 'p1', qty: 10, unitCostUSD: 1 }], totalUSD: 10 });
    await owner.engine.sync();
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(10);
    await owner.engine.createDoc('reversal', 'u_owner', s.A.id, { id: reversalIdFor(po.id), refKind: 'purchase', refId: po.id, reason: 'doublon', ...inverseOf('purchase', po) });
    await owner.engine.sync();
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(0);
    expect(await localStock(owner.engine, s.A.id, 'p1')).toBe(0);
    expect(getRecord(s.db, 'purchase', po.id)).toBeTruthy(); // original still there
  });

  it('the server rebuilds the opposite effects itself and allows one reversal only', async () => {
    const s = await makeServer();
    s.admin([s.doc('adjustment', { id: 'adj1', storeId: s.A.id, productId: 'p1', qty: 5, reason: 'found', note: 'trouvé' }, 'u_mA')]);
    const bad = { movements: [{ storeId: s.A.id, productId: 'p1', qty: -500 }], ledger: [] };
    s.admin([s.doc('reversal', { id: 'rev_adj1', storeId: s.A.id, refKind: 'adjustment', refId: 'adj1', reason: 'erreur', ...bad })]);
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(0);
    const again = pushOps(s.db, { id: 'dev_seed', code: 'S0', scope: null }, [s.doc('reversal', { id: 'rev_adj1', storeId: s.A.id, refKind: 'adjustment', refId: 'adj1', reason: 'encore', movements: [], ledger: [] })]);
    expect(again[0].status).toBe('duplicate');
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(0);
  });

  it('cancels a received transfer (reception, then sending) and a repayment', async () => {
    const s = await makeServer();
    s.admin([
      s.doc('purchase', { id: 'po', storeId: s.A.id, supplierId: null, lines: [{ productId: 'p2', qty: 4, unitCostUSD: 9 }], totalUSD: 36 }, 'u_mA'),
      s.doc('transfer_send', { id: 'ts', storeId: s.A.id, toStoreId: s.B.id, lines: [{ productId: 'p2', qty: 3 }] }, 'u_mA'),
      s.doc('transfer_receive', { id: receiveIdFor('ts'), storeId: s.B.id, sendId: 'ts', fromStoreId: s.A.id, lines: [{ productId: 'p2', qty: 3 }] }, 'u_mB'),
      s.doc('repayment', { id: 'rp', storeId: s.B.id, customerId: 'c1', method: 'cash', currency: 'USD', amount: 20, amountUSD: 20, rate: 2300 }, 'u_sB'),
    ]);
    // sending cannot be cancelled while the reception stands
    const early = pushOps(s.db, { id: 'dev_seed', code: 'S0', scope: null }, [s.doc('reversal', { id: 'rev_ts', storeId: s.A.id, refKind: 'transfer_send', refId: 'ts', reason: 'essai', movements: [], ledger: [] })]);
    expect(early[0]).toMatchObject({ status: 'rejected', error: 'transfer_already_received' });
    s.admin([
      s.doc('reversal', { id: reversalIdFor(receiveIdFor('ts')), storeId: s.B.id, refKind: 'transfer_receive', refId: receiveIdFor('ts'), reason: 'erreur', movements: [], ledger: [] }),
      s.doc('reversal', { id: 'rev_ts', storeId: s.A.id, refKind: 'transfer_send', refId: 'ts', reason: 'erreur', movements: [], ledger: [] }),
      s.doc('reversal', { id: 'rev_rp', storeId: s.B.id, refKind: 'repayment', refId: 'rp', reason: 'faux', movements: [], ledger: [] }),
    ]);
    expect(getRecord(s.db, 'stock', `${s.A.id}:p2`)!.data.qty).toBe(4);
    expect(getRecord(s.db, 'stock', `${s.B.id}:p2`)!.data.qty).toBe(0);
    const ledger = s.db.prepare("SELECT data FROM records WHERE kind='ledger'").all().map((r: any) => JSON.parse(r.data));
    expect(customerBalances(ledger, Date.now()).get('c1')!.balanceUSD).toBe(0);
  });

  it('only the owner, on the all-store device, can cancel operations', async () => {
    const s = await makeServer();
    s.admin([s.doc('adjustment', { id: 'adj2', storeId: s.A.id, productId: 'p1', qty: 2, reason: 'found', note: 'trouvé' }, 'u_mA')]);
    const d = await s.enroll('managera', 'manager-a-pass', s.A.id);
    const dev = s.db.prepare('SELECT id, code, scope FROM devices WHERE id = ?').get(d.deviceId) as any;
    const r = pushOps(s.db, dev, [
      { ...s.doc('reversal', { id: 'rev_adj2', storeId: s.A.id, refKind: 'adjustment', refId: 'adj2', reason: 'essai', movements: [], ledger: [] }, 'u_mA'), data: { id: 'rev_adj2', storeId: s.A.id, userId: 'u_mA', deviceId: dev.id, at: Date.now(), refKind: 'adjustment', refId: 'adj2', reason: 'essai', movements: [], ledger: [] } } as any,
      { ...s.doc('reversal', {}, 'u_owner'), opId: 'rev_adj2', data: { id: 'rev_adj2', storeId: s.A.id, userId: 'u_owner', deviceId: dev.id, at: Date.now(), refKind: 'adjustment', refId: 'adj2', reason: 'essai', movements: [], ledger: [] } } as any,
    ]);
    expect(r.map((x) => x.error)).toEqual(['forbidden', 'forbidden']);
  });
});

describe('default team', () => {
  it('creates the 9 staff members once, with PINs, without manager passwords', async () => {
    const s = await makeServer();
    await createStaff(s.db);
    await createStaff(s.db); // second run adds nothing
    const users = s.db.prepare("SELECT data FROM records WHERE kind='user'").all().map((r: any) => JSON.parse(r.data));
    for (const [, name] of STAFF) expect(users.filter((u: any) => u.name === name)).toHaveLength(1);
    expect(s.db.prepare("SELECT COUNT(*) n FROM credentials WHERE username IN ('ibanda','kadutu','bagira')").get()).toEqual({ n: 0 });
  });
});
