// Garage: vehicle arrival, mechanic checklist, parts from a shop on a bon de sortie,
// returns, invoice on credit for an NGO, and who may do what.
import { describe, expect, it } from 'vitest';
import { makeServer } from './helpers';
import { getRecord } from '../server/db';
import { pushOps } from '../server/sync';
import { hashPin } from '../shared/pin';
import { customerBalances } from '../shared/reports';
import { invoiceLines, jobEstimate, jobParts, needsReapproval } from '../shared/garage';
import { validatePatch } from '../shared/schemas';

async function withGarage() {
  const s = await makeServer();
  s.admin([
    s.patch('store', 'st_garage', { name: 'Inter-Diesel Garage', code: 'GAR', address: '', phone: '', kind: 'garage', active: true }),
    s.patch('user', 'u_chef', { name: 'Chef atelier', role: 'manager', storeId: 'st_garage', pinHash: await hashPin('5555', 'u_chef'), phone: '', active: true }),
    s.patch('user', 'u_meca', { name: 'Mécanicien', role: 'mechanic', storeId: 'st_garage', pinHash: await hashPin('6666', 'u_meca'), phone: '', active: true }),
    s.patch('customer', 'c_ngo', { name: 'ONG Santé Kivu', phone: '+243990000009', note: '', creditLimitUSD: 5000, type: 'ngo', poRequired: true, active: true }),
    s.patch('vehicle', 'v1', { plate: 'CGO 1234 AB', make: 'Toyota', model: 'Land Cruiser 79', customerId: 'c_ngo', km: 120000, active: true }),
    s.doc('purchase', { id: 'po1', storeId: s.A.id, supplierId: null, lines: [{ productId: 'p1', qty: 10, unitCostUSD: 1 }, { productId: 'p2', qty: 5, unitCostUSD: 9 }], totalUSD: 55 }, 'u_mA'),
  ]);
  const job = {
    no: 'GAR-OR-S001',
    storeId: 'st_garage',
    vehicleId: 'v1',
    customerId: 'c_ngo',
    status: 'arrived',
    arrivedAt: Date.now(),
    km: 120500,
    fuel: 4,
    complaint: 'Bruit au freinage',
  };
  s.admin([s.patch('job', 'j1', job, 'u_meca')]);
  return s;
}

const issueDoc = (id: string, storeId: string, lines: any[], extra: Record<string, any> = {}) => ({
  id,
  storeId,
  no: `BS-${id}`,
  jobId: 'j1',
  jobNo: 'GAR-OR-S001',
  lines,
  takenBy: 'Mécanicien',
  ...extra,
});

describe('garage', () => {
  it('registers an arrival and lets two mechanics tick different checklist items without overwriting each other', async () => {
    const s = await withGarage();
    s.admin([s.patch('job', 'j1', { ck_brake_pads_front: { s: 'fix', note: 'usées à 90%' } }, 'u_meca')]);
    s.admin([s.patch('job', 'j1', { ck_tyres: { s: 'ok' } }, 'u_chef')]);
    const j = getRecord(s.db, 'job', 'j1')!.data;
    expect(j.ck_brake_pads_front).toEqual({ s: 'fix', note: 'usées à 90%' });
    expect(j.ck_tyres).toEqual({ s: 'ok' });
    expect(validatePatch('job', { ck_Bad: { s: 'ok' } }).ok).toBe(false);
    expect(validatePatch('job', { ck_tyres: { s: 'great' } }).ok).toBe(false);
  });

  it('a shop hands parts out on a bon de sortie: shop stock goes down, the job gets the parts; unused parts come back', async () => {
    const s = await withGarage();
    s.admin([s.doc('issue', issueDoc('bs1', s.A.id, [{ productId: 'p1', name: 'Bougie', qty: 4, unitUSD: 2.5, costUSD: 1 }]), 'u_sA')]);
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(6);
    // bring 1 back
    s.admin([s.doc('issue', issueDoc('bs2', s.A.id, [{ productId: 'p1', name: 'Bougie', qty: 1, unitUSD: 2.5, costUSD: 1 }], { returned: true }), 'u_sA')]);
    expect(getRecord(s.db, 'stock', `${s.A.id}:p1`)!.data.qty).toBe(7);
    // cannot bring back more than was handed out
    const r = pushOps(s.db, { id: 'dev_seed', code: 'S0', scope: null }, [
      s.doc('issue', issueDoc('bs3', s.A.id, [{ productId: 'p1', name: 'Bougie', qty: 9, unitUSD: 2.5, costUSD: 1 }], { returned: true }), 'u_sA'),
    ]);
    expect(r[0]).toMatchObject({ status: 'rejected', error: 'return_more_than_issued' });
    const issues = ['bs1', 'bs2'].map((id) => getRecord(s.db, 'issue', id)!.data);
    const parts = jobParts(issues, new Set());
    expect(parts).toMatchObject([{ productId: 'p1', qty: 3, unitUSD: 2.5, byStore: { [s.A.id]: 3 } }]);
  });

  it('estimate counts parts once, flags extra work above the approved amount, and the NGO invoice goes on its account', async () => {
    const s = await withGarage();
    s.admin([s.doc('issue', issueDoc('bs1', s.A.id, [{ productId: 'p2', name: 'Kit chaîne', qty: 1, unitUSD: 15, costUSD: 9 }]), 'u_sA')]);
    const job = { labour: [{ serviceId: null, name: 'Freins avant', qty: 1, unitUSD: 20 }], needs: [{ productId: 'p2', qty: 2, fromStoreId: s.A.id }], approvedTotalUSD: 40 };
    const parts = jobParts([getRecord(s.db, 'issue', 'bs1')!.data], new Set());
    const products = new Map(['p1', 'p2'].map((id) => [id, getRecord(s.db, 'product', id)!.data as any]));
    const est = jobEstimate(job, parts, products);
    expect(est).toEqual({ labourUSD: 20, partsUSD: 30, totalUSD: 50 }); // 1 issued + 1 still needed at 15
    expect(needsReapproval(job, est.totalUSD)).toBe(true);

    const lines = invoiceLines(job, parts, products);
    const inv = {
      id: 'inv1',
      storeId: 'st_garage',
      no: 'GAR-FG-S001',
      jobId: 'j1',
      jobNo: 'GAR-OR-S001',
      vehicleId: 'v1',
      customerId: 'c_ngo',
      rate: 2300,
      lines,
      discountUSD: 0,
      totalUSD: 35,
      payments: [{ method: 'credit', currency: 'USD', amount: 35, amountUSD: 35 }],
      changeUSD: 0,
    };
    // this NGO wants its purchase-order number on every invoice
    const noPo = pushOps(s.db, { id: 'dev_seed', code: 'S0', scope: null }, [s.doc('job_invoice', inv, 'u_chef')]);
    expect(noPo[0]).toMatchObject({ status: 'rejected', error: 'po_required' });
    s.admin([s.doc('job_invoice', { ...inv, poNumber: 'PO-2026-17' }, 'u_chef')]);
    const ledger = s.db.prepare("SELECT data FROM records WHERE kind='ledger'").all().map((r: any) => JSON.parse(r.data));
    expect(customerBalances(ledger, Date.now()).get('c_ngo')!.balanceUSD).toBe(35);
    // one invoice per job
    const again = pushOps(s.db, { id: 'dev_seed', code: 'S0', scope: null }, [s.doc('job_invoice', { ...inv, id: 'inv2', poNumber: 'PO-2026-17' }, 'u_chef')]);
    expect(again[0]).toMatchObject({ status: 'rejected', error: 'job_already_invoiced' });
  });

  it('mechanics work on jobs but cannot price, invoice or touch another store; shops cannot edit garage jobs', async () => {
    const s = await withGarage();
    const seed = { id: 'dev_seed', code: 'S0', scope: null };
    const r = pushOps(s.db, seed, [
      s.patch('job', 'j1', { labour: [{ serviceId: null, name: 'x', qty: 1, unitUSD: 100 }] }, 'u_meca'),
      s.patch('job', 'j1', { diagnosis: 'Plaquettes à changer' }, 'u_meca'),
      s.patch('job', 'j1', { diagnosis: 'hack' }, 'u_mA'),
      s.patch('job', 'j2', { no: 'X', storeId: s.A.id, vehicleId: 'v1', status: 'arrived', arrivedAt: Date.now(), complaint: '' }),
      s.patch('photo', 'job_j1_1', { dataUrl: 'data:image/jpeg;base64,AAAA' }, 'u_meca'),
      s.patch('photo', 'p1', { dataUrl: 'data:image/jpeg;base64,AAAA' }, 'u_meca'),
      s.patch('service', 'sv1', { name: 'Vidange', category: 'Entretien', priceUSD: 15, active: true }, 'u_meca'),
    ]);
    expect(r.map((x) => x.error ?? x.status)).toEqual(['forbidden', 'ok', 'wrong_store_for_user', 'not_a_garage', 'ok', 'forbidden', 'forbidden']);
  });
});
