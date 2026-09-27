// Garage (workshop) logic shared by the app and the server: the mechanic's checklist,
// what parts a job has received, its estimate and invoice lines, and the texts sent
// on WhatsApp (quote, invoice, bon de sortie, service reminder).
import type { T } from './i18n';
import type { CheckState, Customer, Issue, Job, JobInvoice, JobInvoiceLine, JobStatus, Product, Store, Vehicle } from './types';
import { fmtCDF, fmtUSD, round2, usdToCdf } from './money';
import { fmtDate, fmtDateTime, DAY_MS } from './time';

/** Mechanic's inspection checklist. Keys are stable: they are stored as `ck_<key>`. */
export const CHECKLIST: { group: string; items: string[] }[] = [
  { group: 'engine', items: ['oil_level', 'oil_leak', 'coolant', 'belts', 'air_filter', 'fuel_filter', 'injection', 'exhaust'] },
  { group: 'brakes', items: ['brake_pads_front', 'brake_pads_rear', 'brake_discs', 'brake_fluid', 'handbrake'] },
  { group: 'running', items: ['tyres', 'spare_wheel', 'shock_absorbers', 'steering', 'ball_joints', 'wheel_bearings'] },
  { group: 'transmission', items: ['clutch', 'gearbox', 'transfer_4x4', 'drive_shafts'] },
  { group: 'electric', items: ['battery', 'alternator', 'starter', 'lights_front', 'lights_rear', 'indicators', 'horn', 'wipers'] },
  { group: 'body', items: ['body', 'windscreen', 'doors_locks', 'seats_belts', 'air_conditioning'] },
];
export const CHECK_ITEMS = CHECKLIST.flatMap((g) => g.items);
export const checkKey = (item: string) => `ck_${item}` as const;

/** Things commonly left in a vehicle, noted on arrival so nothing goes missing. */
export const ARRIVAL_ITEMS = ['spare_wheel', 'jack', 'wheel_brace', 'triangle', 'extinguisher', 'radio', 'documents', 'first_aid', 'tools', 'mats'];

/** Board columns, in the order a job moves through the workshop. */
export const BOARD: JobStatus[] = ['arrived', 'diagnosis', 'quote', 'approved', 'in_progress', 'waiting_parts', 'ready'];
export const OPEN_STATUSES: JobStatus[] = BOARD;

export function checklistSummary(job: Partial<Job>): Record<CheckState | 'todo', number> {
  const out = { ok: 0, watch: 0, fix: 0, na: 0, todo: 0 };
  for (const item of CHECK_ITEMS) {
    const v = (job as any)[checkKey(item)] as { s: CheckState } | undefined;
    if (v?.s) out[v.s]++;
    else out.todo++;
  }
  return out;
}

export interface JobPart {
  productId: string;
  name: string;
  qty: number; // net quantity issued (issued - returned)
  unitUSD: number;
  costUSD: number;
  byStore: Record<string, number>;
}

/** Parts a job has actually received, net of returns. Cancelled bons de sortie are ignored. */
export function jobParts(issues: Issue[], reversed: Set<string>): JobPart[] {
  const map = new Map<string, JobPart>();
  for (const x of [...issues].sort((a, b) => a.at - b.at)) {
    if (reversed.has(x.id)) continue;
    for (const l of x.lines) {
      const p = map.get(l.productId) ?? { productId: l.productId, name: l.name, qty: 0, unitUSD: l.unitUSD, costUSD: l.costUSD, byStore: {} };
      const q = x.returned ? -l.qty : l.qty;
      p.qty += q;
      p.byStore[x.storeId] = (p.byStore[x.storeId] ?? 0) + q;
      if (!x.returned) {
        p.unitUSD = l.unitUSD; // price at the last bon de sortie
        p.costUSD = l.costUSD;
      }
      map.set(l.productId, p);
    }
  }
  return [...map.values()].filter((p) => p.qty !== 0);
}

/** For each part the job needs: how many the named store has already handed out. */
export function needsProgress(job: Pick<Job, 'needs'>, parts: JobPart[]) {
  return (job.needs ?? []).map((n) => {
    const got = parts.find((p) => p.productId === n.productId)?.byStore[n.fromStoreId] ?? 0;
    return { ...n, issued: Math.max(0, got), missing: Math.max(0, n.qty - got) };
  });
}

export function labourTotal(job: Pick<Job, 'labour'>): number {
  return round2((job.labour ?? []).reduce((a, l) => a + round2(l.qty * l.unitUSD), 0));
}

/**
 * Estimate shown on the quote: labour + parts already issued + parts still needed
 * (at today's price). Parts are never counted twice.
 */
export function jobEstimate(job: Pick<Job, 'labour' | 'needs'>, parts: JobPart[], products: Map<string, Product>) {
  const labour = labourTotal(job);
  let partsUSD = 0;
  for (const p of parts) partsUSD += round2(p.qty * p.unitUSD);
  for (const n of needsProgress(job, parts)) {
    if (n.missing > 0) partsUSD += round2(n.missing * (products.get(n.productId)?.priceUSD ?? 0));
  }
  partsUSD = round2(partsUSD);
  return { labourUSD: labour, partsUSD, totalUSD: round2(labour + partsUSD) };
}

/** Extra work needs a new approval when the estimate goes above what was approved. */
export function needsReapproval(job: Pick<Job, 'approvedTotalUSD'>, estimateUSD: number): boolean {
  return job.approvedTotalUSD != null && estimateUSD > job.approvedTotalUSD + 0.009;
}

export function invoiceLines(job: Pick<Job, 'labour'>, parts: JobPart[], products: Map<string, Product>): JobInvoiceLine[] {
  const out: JobInvoiceLine[] = [];
  for (const p of parts) {
    if (p.qty <= 0) continue;
    out.push({ kind: 'part', productId: p.productId, serviceId: null, name: p.name, ref: products.get(p.productId)?.ref ?? '', qty: p.qty, unitUSD: p.unitUSD, costUSD: p.costUSD });
  }
  for (const l of job.labour ?? []) {
    out.push({ kind: 'labour', productId: null, serviceId: l.serviceId, name: l.name, ref: '', qty: l.qty, unitUSD: l.unitUSD, costUSD: 0 });
  }
  return out;
}

export function daysIn(job: Pick<Job, 'arrivedAt' | 'deliveredAt'>, now: number): number {
  return Math.max(0, Math.floor(((job.deliveredAt ?? now) - job.arrivedAt) / DAY_MS));
}

/** Service due soon: by date within `days`, or by km within `kmMargin` of the last reading. */
export function serviceDue(v: Vehicle, now: number, days = 14, kmMargin = 500): 'overdue' | 'soon' | null {
  const byDate = v.nextServiceAt ? v.nextServiceAt - now : null;
  const byKm = v.nextServiceKm && v.km != null ? v.nextServiceKm - v.km : null;
  if ((byDate != null && byDate < 0) || (byKm != null && byKm < 0)) return 'overdue';
  if ((byDate != null && byDate < days * DAY_MS) || (byKm != null && byKm < kmMargin)) return 'soon';
  return null;
}

export const vehicleLabel = (v?: Pick<Vehicle, 'plate' | 'make' | 'model'> | null) => (v ? `${v.plate} · ${[v.make, v.model].filter(Boolean).join(' ')}` : '');

// ---------- texts (WhatsApp / print) ----------

const line = '------------------------------';

export function quoteText(t: T, a: { job: Job; vehicle?: Vehicle; customer?: Customer | null; store: Store; parts: JobPart[]; products: Map<string, Product>; rate: number }): string {
  const { job, vehicle, customer, store, parts, products, rate } = a;
  const est = jobEstimate(job, parts, products);
  const out: string[] = [`*${store.name}*`, t('garage.quote.title', { no: job.no }), fmtDate(Date.now())];
  if (customer) out.push(t('receipt.customer', { name: customer.name }));
  if (vehicle) out.push(vehicleLabel(vehicle));
  if (job.poNumber) out.push(t('garage.po', { po: job.poNumber }));
  if (job.diagnosis) out.push('', `${t('garage.diagnosis')}:`, job.diagnosis);
  out.push(line);
  for (const l of job.labour ?? []) out.push(`${l.name}${l.qty !== 1 ? ` x${l.qty}` : ''}: ${fmtUSD(round2(l.qty * l.unitUSD))}`);
  const listed = new Set<string>();
  for (const p of parts) {
    listed.add(p.productId);
    out.push(`${p.qty} x ${p.name}: ${fmtUSD(round2(p.qty * p.unitUSD))}`);
  }
  for (const n of needsProgress(job, parts)) {
    if (n.missing <= 0) continue;
    const p = products.get(n.productId);
    out.push(`${n.missing} x ${p?.name ?? n.productId}: ${fmtUSD(round2(n.missing * (p?.priceUSD ?? 0)))}`);
  }
  out.push(line);
  out.push(`${t('garage.labour')}: ${fmtUSD(est.labourUSD)}`);
  out.push(`${t('garage.parts')}: ${fmtUSD(est.partsUSD)}`);
  out.push(`*${t('receipt.total')}: ${fmtUSD(est.totalUSD)}*  (${fmtCDF(usdToCdf(est.totalUSD, rate))})`);
  out.push('', t('garage.quote.reply'));
  return out.join('\n');
}

export function invoiceText(t: T, a: { inv: JobInvoice; vehicle?: Vehicle; customer?: Customer | null; store: Store }): string {
  const { inv, vehicle, customer, store } = a;
  const out: string[] = [`*${store.name}*`];
  if (store.address) out.push(store.address);
  out.push('', t('garage.invoice.title', { no: inv.no }), fmtDateTime(inv.at), t('garage.jobRef', { no: inv.jobNo }));
  if (customer) out.push(t('receipt.customer', { name: customer.name }));
  if (vehicle) out.push(vehicleLabel(vehicle));
  if (inv.poNumber) out.push(t('garage.po', { po: inv.poNumber }));
  out.push(line);
  for (const l of inv.lines) out.push(`${l.qty} x ${l.name}`, `   ${fmtUSD(l.unitUSD)} = ${fmtUSD(round2(l.qty * l.unitUSD))}`);
  out.push(line);
  if (inv.discountUSD > 0) out.push(`${t('receipt.discount')}: -${fmtUSD(inv.discountUSD)}`);
  out.push(`*${t('receipt.total')}: ${fmtUSD(inv.totalUSD)}*  (${fmtCDF(usdToCdf(inv.totalUSD, inv.rate))})`);
  for (const p of inv.payments) out.push(`${t(`pay.${p.method}`)}: ${p.currency === 'USD' ? fmtUSD(p.amount) : fmtCDF(p.amount)}`);
  if (inv.changeUSD > 0) out.push(`${t('receipt.change')}: ${fmtUSD(inv.changeUSD)}`);
  out.push(t('receipt.rate', { rate: inv.rate }), '', t('receipt.thanks'));
  return out.join('\n');
}

export function issueText(t: T, a: { issue: Issue; store: Store; jobVehicle?: string; userName: string }): string {
  const { issue, store } = a;
  const out: string[] = [`*${t(issue.returned ? 'issue.returnTitle' : 'issue.title', { no: issue.no })}*`, store.name, fmtDateTime(issue.at), t('garage.jobRef', { no: issue.jobNo })];
  if (a.jobVehicle) out.push(a.jobVehicle);
  out.push(line);
  for (const l of issue.lines) out.push(`${l.qty} x ${l.name}`);
  out.push(line, t('issue.givenBy', { name: a.userName }), t('issue.takenBy', { name: issue.takenBy }));
  if (issue.note) out.push(issue.note);
  return out.join('\n');
}

export function reminderText(t: T, a: { vehicle: Vehicle; customer?: Customer | null; store: Store }): string {
  const { vehicle, customer, store } = a;
  const when = [
    vehicle.nextServiceAt ? t('garage.reminder.date', { date: fmtDate(vehicle.nextServiceAt) }) : '',
    vehicle.nextServiceKm ? t('garage.reminder.km', { km: vehicle.nextServiceKm.toLocaleString('fr-FR') }) : '',
  ]
    .filter(Boolean)
    .join(t('garage.reminder.or'));
  return t('garage.reminder.text', { name: customer?.name ?? '', vehicle: vehicleLabel(vehicle), when, store: store.name, phone: store.phone ?? '' });
}

export function jobCardText(t: T, a: { job: Job; vehicle?: Vehicle; customer?: Customer | null; store: Store }): string {
  const { job, vehicle, customer, store } = a;
  const out: string[] = [`*${store.name}*`, t('garage.card.title', { no: job.no }), fmtDateTime(job.arrivedAt)];
  if (customer) out.push(t('receipt.customer', { name: customer.name }));
  if (vehicle) out.push(vehicleLabel(vehicle));
  if (job.km != null) out.push(t('garage.card.km', { km: job.km.toLocaleString('fr-FR') }));
  if (job.fuel != null) out.push(t('garage.card.fuel', { n: job.fuel }));
  if (job.keyTag) out.push(t('garage.card.key', { tag: job.keyTag }));
  out.push(line, `${t('garage.complaint')}:`, job.complaint || '—');
  if (job.damage) out.push('', `${t('garage.damage')}:`, job.damage);
  if (job.arrivalItems?.length) out.push('', `${t('garage.arrivalItems')}:`, job.arrivalItems.map((i) => t(`garage.item.${i}`)).join(', '));
  out.push(line, t('garage.card.sign'));
  return out.join('\n');
}
