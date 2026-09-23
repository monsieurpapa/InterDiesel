// Regression tests for the problems found in the release review.
import { describe, expect, it } from 'vitest';
import { localStock, makeServer, saleData } from './helpers';
import { getRecord, newEpoch } from '../server/db';
import { pushOps } from '../server/sync';
import { receiveIdFor } from '../shared/derive';

const deviceRow = (s: any, id: string) => s.db.prepare('SELECT id, code, scope FROM devices WHERE id = ?').get(id);

describe('review fixes: sync', () => {
  it('a rejected sale can be retried after the cause is fixed', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p1', 1, 2.5, { credit: true, customerId: 'c9' }));
    await a.engine.sync();
    expect(a.engine.status.rejected).toBe(1);
    s.admin([s.patch('customer', 'c9', { name: 'Nouveau client', phone: '', note: '', active: true })]);
    const item = (await a.engine.db.outbox.toArray())[0];
    await a.engine.retry(item.seq!);
    await a.engine.sync();
    expect(a.engine.status.rejected).toBe(0);
    expect(a.engine.status.pending).toBe(0);
    expect(s.db.prepare("SELECT COUNT(*) n FROM records WHERE kind='sale'").get()).toEqual({ n: 1 });
  });

  it('pushes a backlog of 450 offline sales in a single sync', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    a.net.online = false;
    for (let i = 0; i < 450; i++) await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', i, 'p1', 1, 2.5));
    a.net.online = true;
    await a.engine.sync();
    expect(a.engine.status.pending).toBe(0);
    expect(a.engine.status.state).toBe('idle');
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(-450);
    expect(await localStock(a.engine, s.A.id, 'p1')).toBe(-450);
  }, 60_000);

  it('a phone whose date reset to 2000 while offline still dates its sales correctly', async () => {
    const s = await makeServer();
    let skew = 0;
    const a = await s.device('managera', 'manager-a-pass', s.A.id, () => Date.now() + skew);
    a.net.online = false;
    skew = Date.parse('2000-01-01') - Date.now(); // battery died, clock reset
    const sale = await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p1', 1, 2.5));
    expect(sale.at).toBeGreaterThan(Date.now() - 60_000);
    a.net.online = true;
    await a.engine.sync();
    expect(a.engine.status.rejected).toBe(0);
    expect(getRecord(s.db, 'sale', sale.id)).toBeTruthy();
  });

  it('after the server is restored from an older backup, devices re-send what is missing', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    const early = await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p1', 1, 2.5));
    await a.engine.sync();
    // "backup" = the current state; then more sales are confirmed...
    const backup = s.db.serialize();
    const late = await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 2, 'p1', 2, 2.5));
    await a.engine.sync();
    expect(a.engine.status.pending).toBe(0);
    // ...and the server is restored from the backup (new epoch, like `cli restore`).
    const Database = (await import('better-sqlite3')).default;
    const restored = new Database(backup);
    s.db.exec('DELETE FROM records; DELETE FROM oplog;');
    for (const r of restored.prepare('SELECT * FROM records').all() as any[])
      s.db.prepare('INSERT INTO records(kind,id,scope,seq,data,clocks) VALUES (?,?,?,?,?,?)').run(r.kind, r.id, r.scope, r.seq, r.data, r.clocks);
    const seq = (restored.prepare("SELECT value FROM counters WHERE name='seq'").get() as any).value;
    s.db.prepare("UPDATE counters SET value = ? WHERE name='seq'").run(seq);
    newEpoch(s.db);
    expect(getRecord(s.db, 'sale', late.id)).toBeNull();

    await a.engine.sync(); // detects the new epoch, re-queues its own documents
    await a.engine.sync();
    expect(getRecord(s.db, 'sale', early.id)).toBeTruthy();
    expect(getRecord(s.db, 'sale', late.id)).toBeTruthy();
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(-3);
    expect(await localStock(a.engine, s.A.id, 'p1')).toBe(-3);
    expect(a.engine.status.pending).toBe(0);
  });
});

describe('review fixes: security', () => {
  it('on a store device the owner cannot manage users or other stores', async () => {
    const s = await makeServer();
    const d = await s.enroll('managera', 'manager-a-pass', s.A.id);
    const dev = deviceRow(s, d.deviceId);
    const res = pushOps(s.db, dev, [
      s.patch('user', 'u_sA', { role: 'owner', storeId: null }, 'u_owner'),
      s.patch('user', 'u_owner', { pinHash: 'attacker' }, 'u_owner'),
      s.patch('minstock', `${s.B.id}:p1`, { storeId: s.B.id, productId: 'p1', min: 99999 }, 'u_owner'),
      s.patch('minstock', `${s.A.id}:p1`, { storeId: s.A.id, productId: 'p1', min: 3 }, 'u_owner'),
    ]);
    expect(res.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'ok']);
  });

  it('nobody can block a transfer reception by sending garbage with its id first', async () => {
    const s = await makeServer();
    s.admin([s.doc('purchase', { id: 'po', storeId: s.A.id, supplierId: null, lines: [{ productId: 'p1', qty: 5, unitCostUSD: 1 }], totalUSD: 5 }, 'u_mA')]);
    s.admin([s.doc('transfer_send', { id: 'ts1', storeId: s.A.id, toStoreId: s.B.id, lines: [{ productId: 'p1', qty: 5 }] }, 'u_mA')]);
    const dA = deviceRow(s, (await s.enroll('managera', 'manager-a-pass', s.A.id)).deviceId);
    const dB = deviceRow(s, (await s.enroll('managerb', 'manager-b-pass', s.B.id)).deviceId);
    const junk = pushOps(s.db, dA, [{ type: 'doc', opId: receiveIdFor('ts1'), kind: 'sale', userId: 'u_mA', hlc: '0000000000001:00000:x', data: {} } as any]);
    expect(junk[0].status).toBe('rejected');
    const real = pushOps(s.db, dB, [
      { type: 'doc', opId: receiveIdFor('ts1'), kind: 'transfer_receive', userId: 'u_mB', hlc: '0000000000002:00000:y', data: { id: receiveIdFor('ts1'), storeId: s.B.id, userId: 'u_mB', deviceId: dB.id, at: Date.now(), sendId: 'ts1', fromStoreId: s.A.id, lines: [{ productId: 'p1', qty: 5 }] } } as any,
    ]);
    expect(real[0].status).toBe('ok');
    expect(getRecord(s.db, 'stock', `${s.B.id}:p1`)!.data.qty).toBe(5);
  });

  it('a clock far in the future cannot lock a field', async () => {
    const s = await makeServer();
    s.admin([{ ...s.patch('customer', 'c1', { name: 'HACKED' }, 'u_sA'), hlc: '9999999999999:99999:z' }]);
    s.admin([s.patch('customer', 'c1', { name: 'Garage Umoja' })]);
    expect(getRecord(s.db, 'customer', 'c1')!.data.name).toBe('Garage Umoja');
  });

  it('owner edits made on the owner device are not visible in store devices’ audit', async () => {
    const s = await makeServer();
    const d = await s.enroll('managera', 'manager-a-pass', s.A.id);
    const pull = (await s.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: { authorization: `Bearer ${d.token}` } })).json();
    const userAudits = pull.changes.filter((c: any) => c.kind === 'audit' && String(c.data.kind).startsWith('user.'));
    expect(userAudits).toEqual([]);
  });

  it('repayment amounts must match the currency conversion', async () => {
    const s = await makeServer();
    const r = pushOps(s.db, { id: 'dev_seed', code: 'S0', scope: null }, [
      s.doc('repayment', { id: 'rp1', storeId: s.A.id, customerId: 'c1', method: 'cash', currency: 'CDF', amount: 1, amountUSD: 9000000, rate: 2300 }, 'u_sA'),
    ]);
    expect(r[0].status).toBe('rejected');
  });

  it('a successful login does not reset the failed attempts on another account', async () => {
    const s = await makeServer();
    const post = (username: string, password: string) => s.app.inject({ method: 'POST', url: '/api/enroll/options', payload: { username, password }, remoteAddress: '10.0.0.9' });
    for (let i = 0; i < 9; i++) await post('owner', `guess${i}`);
    expect((await post('managera', 'manager-a-pass')).statusCode).toBe(200);
    expect((await post('owner', 'guess-10')).statusCode).toBe(401);
    expect((await post('owner', 'owner-password')).statusCode).toBe(429);
  });
});
