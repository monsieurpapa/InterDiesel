import { describe, expect, it } from 'vitest';
import { makeServer } from './helpers';
import { getRecord } from '../server/db';
import { hashPin } from '../shared/pin';
import { buildMessages } from '../server/notify/jobs';
import { WhatsAppCloudChannel } from '../server/notify/whatsapp-cloud';

describe('server security', () => {
  it('a manager can only enroll devices for their own store; wrong passwords are refused', async () => {
    const s = await makeServer();
    const post = (url: string, payload: object) => s.app.inject({ method: 'POST', url, payload });
    expect((await post('/api/enroll', { username: 'managera', password: 'nope', storeId: s.A.id })).statusCode).toBe(401);
    expect((await post('/api/enroll', { username: 'managera', password: 'manager-a-pass', storeId: s.B.id })).statusCode).toBe(403);
    expect((await post('/api/enroll', { username: 'managera', password: 'manager-a-pass', storeId: null })).statusCode).toBe(403);
    const opts = (await post('/api/enroll/options', { username: 'managera', password: 'manager-a-pass' })).json();
    expect(opts.stores.map((x: any) => x.id)).toEqual([s.A.id]);
  });

  it('sync needs a valid, non-revoked device token', async () => {
    const s = await makeServer();
    expect((await s.app.inject({ method: 'GET', url: '/api/sync/pull?since=0' })).statusCode).toBe(401);
    const d = await s.enroll('managera', 'manager-a-pass', s.A.id);
    const auth = { authorization: `Bearer ${d.token}` };
    expect((await s.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })).statusCode).toBe(200);
    const revoke = await s.app.inject({ method: 'POST', url: '/api/admin/devices/revoke', payload: { username: 'owner', password: 'owner-password', deviceId: d.deviceId } });
    expect(revoke.statusCode).toBe(200);
    expect((await s.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })).statusCode).toBe(401);
  });

  it('owner-only endpoints refuse managers', async () => {
    const s = await makeServer();
    const r = await s.app.inject({ method: 'POST', url: '/api/admin/backup', payload: { username: 'managera', password: 'manager-a-pass' } });
    expect(r.statusCode).toBe(403);
    const ok = await s.app.inject({ method: 'POST', url: '/api/admin/backup', payload: { username: 'owner', password: 'owner-password' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('a store device does not receive other stores’ sales, but sees stock levels and debts everywhere', async () => {
    const s = await makeServer();
    s.admin([
      s.doc('sale', { id: 'sB', storeId: s.B.id, no: 'B1', customerId: 'c1', rate: 2300, lines: [{ productId: 'p1', name: 'x', ref: 'x', qty: 1, unitUSD: 2.5, costUSD: 1 }], discountUSD: 0, totalUSD: 2.5, payments: [{ method: 'credit', currency: 'USD', amount: 2.5, amountUSD: 2.5 }], changeUSD: 0 }, 'u_sB'),
    ]);
    const d = await s.enroll('managera', 'manager-a-pass', s.A.id);
    const pull = (await s.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: { authorization: `Bearer ${d.token}` } })).json();
    const kinds = pull.changes.map((c: any) => `${c.kind}:${c.id}`);
    expect(kinds).not.toContain('sale:sB');
    expect(kinds.some((k: string) => k.startsWith('movement:sB'))).toBe(false);
    expect(kinds).toContain(`stock:${s.B.id}:p1`);
    expect(kinds).toContain('ledger:sB:l');
  });

  it('users may change their own PIN only; only managers set credit limits', async () => {
    const s = await makeServer();
    const dev = { id: 'dev_seed', code: 'S0', scope: null };
    const { pushOps } = await import('../server/sync');
    const own = s.patch('user', 'u_sA', { pinHash: await hashPin('9999', 'u_sA') }, 'u_sA');
    const other = s.patch('user', 'u_mA', { pinHash: 'x' }, 'u_sA');
    const limit = s.patch('customer', 'c1', { creditLimitUSD: 10000 }, 'u_sA');
    const phone = s.patch('customer', 'c1', { phone: '+243970000000' }, 'u_sA');
    const res = pushOps(s.db, dev, [own, other, limit, phone]);
    expect(res.map((r) => r.status)).toEqual(['ok', 'rejected', 'rejected', 'ok']);
    expect(getRecord(s.db, 'customer', 'c1')!.data.creditLimitUSD).toBe(500);
  });
});

describe('WhatsApp automation (ready, disabled by default)', () => {
  it('builds the evening messages from server data', async () => {
    const s = await makeServer();
    s.admin([s.patch('user', 'u_owner', { phone: '+243990000009' })]);
    const msgs = buildMessages(s.db, Date.now(), 'evening');
    expect(msgs.filter((m) => m.kind === 'daily_summary')).toHaveLength(3);
    expect(msgs[0].template?.name).toBe('rapport_journalier');
  });

  it('the Cloud API channel posts an approved template when configured', async () => {
    const calls: any[] = [];
    const ch = new WhatsAppCloudChannel({ token: 't', phoneNumberId: '123', apiVersion: 'v23.0' }, (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200 } as any;
    }) as any);
    const r = await ch.send({ kind: 'debt_reminder', to: '+243 99 000 0001', text: 'x', template: { name: 'rappel_dette', language: 'fr', params: ['A', '$5.00'] } });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('https://graph.facebook.com/v23.0/123/messages');
    expect(calls[0].body).toMatchObject({ to: '243990000001', type: 'template', template: { name: 'rappel_dette' } });
    expect(new WhatsAppCloudChannel({ token: '', phoneNumberId: '', apiVersion: 'v23.0' }).canSend({ kind: 'receipt', to: '1', text: '', template: { name: 'a', language: 'fr', params: [] } })).toBe(false);
  });
});
