import { describe, expect, it } from 'vitest';
import { localStock, makeServer, saleData } from './helpers';
import { getRecord } from '../server/db';
import { customerBalances } from '../shared/reports';
import { receiveIdFor } from '../shared/derive';

describe('offline sync', () => {
  it('two devices sell the last unit of the same stock while offline, then both sync: the ledger merges, stock is -1 and flagged', async () => {
    const s = await makeServer();
    // Store A has exactly 1 spark plug.
    s.admin([s.doc('purchase', { id: 'po1', storeId: s.A.id, supplierId: null, lines: [{ productId: 'p1', qty: 1, unitCostUSD: 1 }], totalUSD: 1 }, 'u_mA')]);

    const phone = await s.device('managera', 'manager-a-pass', s.A.id); // seller's phone at the counter
    const laptop = await s.device('owner', 'owner-password', null); // owner's laptop, also selling for store A
    expect(await localStock(phone.engine, s.A.id, 'p1')).toBe(1);
    expect(await localStock(laptop.engine, s.A.id, 'p1')).toBe(1);

    // Network goes down for both.
    phone.net.online = false;
    laptop.net.online = false;

    const sale1 = await phone.engine.createDoc('sale', 'u_sA', s.A.id, saleData('IBA', 1, 'p1', 1, 2.5));
    const sale2 = await laptop.engine.createDoc('sale', 'u_owner', s.A.id, saleData('IBA', 2, 'p1', 1, 2.5));
    await expect(phone.engine.sync()).resolves.toBeUndefined(); // offline: no error, just waits
    expect(phone.engine.status.state).toBe('offline');
    expect(phone.engine.status.pending).toBe(1);

    // Each device shows its own sale; neither knows about the other.
    expect(await localStock(phone.engine, s.A.id, 'p1')).toBe(0);
    expect(await localStock(laptop.engine, s.A.id, 'p1')).toBe(0);

    // Network back. Both push.
    phone.net.online = true;
    laptop.net.online = true;
    await phone.engine.sync();
    await laptop.engine.sync();
    await phone.engine.sync(); // phone pulls the laptop's effect

    // Both sales are kept on the server: no sale lost, no overwrite.
    expect(getRecord(s.db, 'sale', sale1.id)).toBeTruthy();
    expect(getRecord(s.db, 'sale', sale2.id)).toBeTruthy();
    // Stock ledger: +1 purchase, -1, -1 => -1
    const movs = s.db.prepare("SELECT data FROM records WHERE kind='movement'").all().map((r: any) => JSON.parse(r.data));
    expect(movs.filter((m: any) => m.productId === 'p1' && m.storeId === s.A.id).reduce((a: number, m: any) => a + m.qty, 0)).toBe(-1);
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(-1);
    // Negative stock is allowed but flagged for the manager.
    const alert = getRecord(s.db, 'alert', `neg_${s.A.id}:p1`)!.data;
    expect(alert).toMatchObject({ type: 'negative_stock', storeId: s.A.id, qty: -1, resolved: false });

    // Both devices converge on the same number, with nothing left in their outbox.
    expect(await localStock(phone.engine, s.A.id, 'p1')).toBe(-1);
    expect(await localStock(laptop.engine, s.A.id, 'p1')).toBe(-1);
    expect(phone.engine.status.pending).toBe(0);
    expect(laptop.engine.status.pending).toBe(0);
    expect(await phone.engine.db.alert.get(`neg_${s.A.id}:p1`)).toBeTruthy();
  });

  it('two stores sell the same part offline and one sends stock to the other: each store ledger reconciles', async () => {
    const s = await makeServer();
    s.admin([
      s.doc('purchase', { id: 'poA', storeId: s.A.id, supplierId: null, lines: [{ productId: 'p2', qty: 3, unitCostUSD: 9 }], totalUSD: 27 }, 'u_mA'),
      s.doc('purchase', { id: 'poB', storeId: s.B.id, supplierId: null, lines: [{ productId: 'p2', qty: 1, unitCostUSD: 9 }], totalUSD: 9 }, 'u_mB'),
    ]);
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    const b = await s.device('managerb', 'manager-b-pass', s.B.id);
    a.net.online = false;
    b.net.online = false;

    // Offline: A sells 1 and sends 2 to B. B sells its last one, then receives nothing yet.
    await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p2', 1, 15));
    const send = await a.engine.createDoc('transfer_send', 'u_mA', s.A.id, { toStoreId: s.B.id, lines: [{ productId: 'p2', qty: 2 }] });
    await b.engine.createDoc('sale', 'u_sB', s.B.id, saleData('B', 1, 'p2', 1, 15));
    await b.engine.createDoc('sale', 'u_sB', s.B.id, saleData('B', 2, 'p2', 1, 15)); // sold one it did not have
    expect(await localStock(a.engine, s.A.id, 'p2')).toBe(0);
    expect(await localStock(b.engine, s.B.id, 'p2')).toBe(-1);

    b.net.online = true;
    await b.engine.sync();
    a.net.online = true;
    await a.engine.sync();
    await b.engine.sync(); // B now sees the transfer in transit

    expect(await b.engine.db.transfer_send.get(send.id)).toBeTruthy();
    expect(getRecord(s.db, 'stock', `${s.B.id}:p2`)!.data.qty).toBe(-1);
    expect(getRecord(s.db, 'alert', `neg_${s.B.id}:p2`)!.data.resolved).toBe(false);

    // B receives the 2 units (offline again, then syncs).
    b.net.online = false;
    await b.engine.createDoc('transfer_receive', 'u_mB', s.B.id, { id: receiveIdFor(send.id), sendId: send.id, fromStoreId: s.A.id, lines: [{ productId: 'p2', qty: 2 }] });
    expect(await localStock(b.engine, s.B.id, 'p2')).toBe(1);
    b.net.online = true;
    await b.engine.sync();
    await a.engine.sync();

    expect(getRecord(s.db, 'stock', `${s.A.id}:p2`)!.data.qty).toBe(0); // 3 - 1 - 2
    expect(getRecord(s.db, 'stock', `${s.B.id}:p2`)!.data.qty).toBe(1); // 1 - 2 + 2
    expect(await localStock(a.engine, s.A.id, 'p2')).toBe(0);
    expect(await localStock(b.engine, s.B.id, 'p2')).toBe(1);
    // A store device also sees the other store's level (for transfers), from the server.
    expect(await localStock(a.engine, s.B.id, 'p2')).toBe(1);
  });

  it('re-sending the same operations after a dropped connection does not double count', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    const sale = await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p1', 2, 2.5));
    const op = (await a.engine.db.outbox.toArray())[0].op;
    // First push reaches the server but the phone never gets the answer.
    const { pushOps } = await import('../server/sync');
    const dev = s.db.prepare('SELECT id, code, scope FROM devices WHERE id = ?').get(a.engine.device!.deviceId) as any;
    pushOps(s.db, dev, [op]);
    await a.engine.sync(); // pushes again
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(-2);
    expect(a.engine.status.pending).toBe(0);
    expect(await localStock(a.engine, s.A.id, 'p1')).toBe(-2);
    expect(getRecord(s.db, 'sale', sale.id)).toBeTruthy();
  });

  it('catalog edits made offline on two devices merge field by field; the later price wins', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    const b = await s.device('managerb', 'manager-b-pass', s.B.id);
    a.net.online = false;
    b.net.online = false;
    await a.engine.patch('product', 'p1', 'u_mA', { priceUSD: 3 });
    await a.engine.patch('product', 'p1', 'u_mA', { name: 'Bougie NGK D8EA' });
    await new Promise((r) => setTimeout(r, 5));
    await b.engine.patch('product', 'p1', 'u_mB', { priceUSD: 2.8 }); // later
    a.net.online = b.net.online = true;
    await b.engine.sync();
    await a.engine.sync();
    await b.engine.sync();
    const p = getRecord(s.db, 'product', 'p1')!.data;
    expect(p.priceUSD).toBe(2.8);
    expect(p.name).toBe('Bougie NGK D8EA');
    expect((await a.engine.db.product.get('p1')).priceUSD).toBe(2.8);
    expect((await b.engine.db.product.get('p1')).name).toBe('Bougie NGK D8EA');
    // the price change is in the audit log with old and new values
    const audits = s.db.prepare("SELECT data FROM records WHERE kind='audit'").all().map((r: any) => JSON.parse(r.data));
    expect(audits.some((x: any) => x.refId === 'p1' && x.changes?.priceUSD)).toBe(true);
  });

  it('customer debt from credit sales in two stores and a repayment adds up everywhere', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    const b = await s.device('managerb', 'manager-b-pass', s.B.id);
    a.net.online = b.net.online = false;
    await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p2', 2, 15, { credit: true, customerId: 'c1' }));
    await b.engine.createDoc('sale', 'u_sB', s.B.id, saleData('B', 1, 'p1', 4, 2.5, { credit: true, customerId: 'c1' }));
    await b.engine.createDoc('repayment', 'u_sB', s.B.id, { customerId: 'c1', method: 'cash', currency: 'CDF', amount: 23000, amountUSD: 10, rate: 2300 });
    a.net.online = b.net.online = true;
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    for (const e of [a.engine, b.engine]) {
      const bal = customerBalances(await e.db.ledger.toArray(), Date.now()).get('c1')!;
      expect(bal.balanceUSD).toBe(30);
    }
  });

  it('refuses what a role may not do, keeps it visible on the device, and flags it', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    // A seller tries a stock adjustment (the app hides this; a tampered app could still try).
    await a.engine.createDoc('adjustment', 'u_sA', s.A.id, { productId: 'p1', qty: 50, reason: 'found', note: 'test' });
    await a.engine.sync();
    expect(a.engine.status.rejected).toBe(1);
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)).toBeNull();
    const items = await a.engine.db.outbox.toArray();
    expect(items[0].error).toBe('forbidden');
    // A device of store A cannot act for store B either.
    await a.engine.createDoc('sale', 'u_mA', s.B.id, saleData('B', 9, 'p1', 1, 2.5));
    await a.engine.sync();
    expect(a.engine.status.rejected).toBe(2);
    // Discarding removes the local effect.
    await a.engine.discard(items[0].seq!);
    expect(await localStock(a.engine, s.A.id, 'p1')).toBe(0);
  });

  it('a phone with a wrong clock still records sales at the right time after its first sync', async () => {
    const s = await makeServer();
    // The phone thinks it is 3 days ago.
    const a = await s.device('managera', 'manager-a-pass', s.A.id, () => Date.now() - 3 * 86_400_000);
    const sale = await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p1', 1, 2.5));
    expect(Math.abs(sale.at - Date.now())).toBeLessThan(60_000);
  });

  it('a voided sale restores stock and cancels the debt, using the server copy of the sale', async () => {
    const s = await makeServer();
    const a = await s.device('managera', 'manager-a-pass', s.A.id);
    const sale = await a.engine.createDoc('sale', 'u_sA', s.A.id, saleData('A', 1, 'p2', 2, 15, { credit: true, customerId: 'c1' }));
    await a.engine.sync();
    await a.engine.createDoc('sale_void', 'u_mA', s.A.id, {
      id: `void_${sale.id}`,
      saleId: sale.id,
      saleNo: 'x',
      reason: 'erreur de saisie',
      lines: [{ productId: 'p2', qty: 99 }], // a wrong client value is ignored by the server
      customerId: 'c1',
      creditUSD: 30,
      refundUSD: 0,
    });
    await a.engine.sync();
    expect(getRecord(s.db, 'stock', `${s.A.id}:p2`)!.data.qty).toBe(0);
    const ledger = s.db.prepare("SELECT data FROM records WHERE kind='ledger'").all().map((r: any) => JSON.parse(r.data));
    expect(ledger.reduce((x: number, l: any) => x + l.amountUSD, 0)).toBe(0);
  });
});
