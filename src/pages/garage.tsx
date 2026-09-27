// Garage (workshop): vehicles in for repair, from arrival to signed exit.
// A job moves: arrival -> mechanic's checklist and diagnosis -> quote and customer
// approval -> parts on bons de sortie + labour -> invoice (paid or on account) -> exit.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ulid } from 'ulid';
import { db, engine, go, notifySave, t, toast, useLive, useSession, useStock } from '../state';
import { Empty, Field, Group, Icon, Page, Section, Seg, useDebounced, norm } from '../ui';
import { ProductPick } from './stock';
import { CustomerSheet, MixedSheet } from './sell';
import { ReverseControl, useReversedIds } from './admin';
import { sendWhatsApp, printText } from '../share';
import {
  ARRIVAL_ITEMS,
  BOARD,
  CHECKLIST,
  CHECK_ITEMS,
  checkKey,
  checklistSummary,
  daysIn,
  invoiceLines,
  invoiceText,
  jobCardText,
  jobEstimate,
  jobParts,
  needsProgress,
  needsReapproval,
  OPEN_STATUSES,
  quoteText,
  reminderText,
  serviceDue,
  vehicleLabel,
  issueText,
  type JobPart,
} from '../../shared/garage';
import { fmtCDF, fmtUSD, round2, usdToCdf } from '../../shared/money';
import { fmtDate, fmtDateTime, DAY_MS } from '../../shared/time';
import type { CheckState, Customer, Issue, Job, JobInvoice, JobStatus, LabourLine, NeedLine, Payment, Service, Store, Vehicle } from '../../shared/types';

// ---------------- data hooks ----------------

/** The garage this screen works on: the device's store if it is a garage, else the first garage. */
export function useGarage(): Store | undefined {
  const s = useSession();
  return s.store.kind === 'garage' ? s.store : s.stores.find((x) => x.kind === 'garage');
}
const useVehicles = () => useLive(() => db.vehicle.toArray() as Promise<Vehicle[]>, [], [] as Vehicle[]);
const useServices = () => useLive(() => db.service.toArray() as Promise<Service[]>, [], [] as Service[]);
function useJobIssues(jobId: string | undefined) {
  return useLive(() => (jobId ? (db.issue.where('jobId').equals(jobId).toArray() as Promise<Issue[]>) : Promise.resolve([] as Issue[])), [jobId], [] as Issue[]);
}
function useJobInvoice(jobId: string | undefined, reversed: Set<string>) {
  const list = useLive(() => (jobId ? (db.job_invoice.where('jobId').equals(jobId).toArray() as Promise<JobInvoice[]>) : Promise.resolve([] as JobInvoice[])), [jobId], [] as JobInvoice[]);
  return list.find((i) => !reversed.has(i.id));
}

const statusTag = (st: JobStatus) => {
  const cls = st === 'ready' ? 'ok' : st === 'waiting_parts' || st === 'quote' ? 'warn' : st === 'cancelled' ? 'bad' : st === 'delivered' ? 'ok' : 'info';
  return <span class={`tag ${cls}`}>{t(`garage.status.${st}`)}</span>;
};

// ---------------- board ----------------

export function GaragePage() {
  const s = useSession();
  const garage = useGarage();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'open' | JobStatus | 'delivered'>('open');
  const dq = useDebounced(q);
  const jobs = useLive(() => (garage ? (db.job.where('storeId').equals(garage.id).toArray() as Promise<Job[]>) : Promise.resolve([] as Job[])), [garage?.id], [] as Job[]);
  const vehicles = useVehicles();
  const vById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const issues = useLive(() => db.issue.toArray() as Promise<Issue[]>, [], [] as Issue[]);
  const reversed = useReversedIds();
  const now = engine.now();
  if (!garage) return <Page title={t('garage.title')}><div class="notice">{t('garage.noGarage')}</div></Page>;

  const open = jobs.filter((j) => OPEN_STATUSES.includes(j.status));
  const byJob = new Map<string, Issue[]>();
  for (const x of issues) byJob.set(x.jobId, [...(byJob.get(x.jobId) ?? []), x]);
  const matches = (j: Job) => {
    if (!dq.trim()) return true;
    const v = vById.get(j.vehicleId);
    const c = s.customers.find((x) => x.id === j.customerId);
    return norm(`${j.no} ${v?.plate ?? ''} ${v?.make ?? ''} ${v?.model ?? ''} ${c?.name ?? ''}`).replace(/\s/g, '').includes(norm(dq).replace(/\s/g, ''));
  };
  const list = jobs
    .filter((j) => (filter === 'open' ? OPEN_STATUSES.includes(j.status) : j.status === filter))
    .filter(matches)
    .sort((a, b) => (filter === 'delivered' ? (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0) : a.arrivedAt - b.arrivedAt))
    .slice(0, 100);
  const counts = new Map<string, number>();
  for (const j of open) counts.set(j.status, (counts.get(j.status) ?? 0) + 1);

  return (
    <Page
      title={t('garage.title')}
      actions={
        s.can('job.create') && (
          <a class="btn primary" href="#/job/new">
            <Icon.plus />
            {t('garage.newJob')}
          </a>
        )
      }
    >
      <div class="headline">
        <div class="label">{garage.name}</div>
        <div class="usd">{t('garage.inShop', { n: open.length })}</div>
        {!!counts.get('ready') && <div class="pos"><b>{t('garage.ready', { n: counts.get('ready')! })}</b></div>}
      </div>
      <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('garage.searchPh')} aria-label={t('garage.searchPh')} />
      <div class="chips" style={{ marginTop: 8 }}>
        <button class={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>{t('common.all')} ({open.length})</button>
        {BOARD.map((st) => (
          <button class={filter === st ? 'on' : ''} onClick={() => setFilter(st)}>
            {t(`garage.status.${st}`)} ({counts.get(st) ?? 0})
          </button>
        ))}
        <button class={filter === 'delivered' ? 'on' : ''} onClick={() => setFilter('delivered')}>{t('garage.history')}</button>
      </div>
      <div class="list">
        {list.map((j) => {
          const v = vById.get(j.vehicleId);
          const c = s.customers.find((x) => x.id === j.customerId);
          const parts = jobParts(byJob.get(j.id) ?? [], reversed);
          const missing = needsProgress(j, parts).reduce((a, n) => a + n.missing, 0);
          const est = jobEstimate(j, parts, s.productById);
          const days = daysIn(j, now);
          return (
            <a class="item" href={`#/job/${j.id}`}>
              <div class="main">
                <div class="title">
                  {v?.plate ?? '?'} <span class="muted" style={{ fontWeight: 500 }}>{[v?.make, v?.model].filter(Boolean).join(' ')}</span>
                </div>
                <div class="sub">{j.no} · {c?.name ?? t('garage.noCustomer')}</div>
                <div class="row" style={{ gap: 4, marginTop: 4 }}>
                  {statusTag(j.status)}
                  {missing > 0 && OPEN_STATUSES.includes(j.status) && <span class="tag warn">{t('garage.partsMissing', { n: missing })}</span>}
                  {needsReapproval(j, est.totalUSD) && OPEN_STATUSES.includes(j.status) && <span class="tag bad">{t('garage.reapprove')}</span>}
                </div>
              </div>
              <div class="end">
                <div class={days > 7 && OPEN_STATUSES.includes(j.status) ? 'neg' : 'muted'}><b>{t('garage.days', { n: days })}</b></div>
              </div>
            </a>
          );
        })}
        {!list.length && <Empty>{t('garage.none')}</Empty>}
      </div>
      <div class="grid2" style={{ marginTop: 16 }}>
        <a class="btn" href="#/vehicles">{t('garage.vehicles')}</a>
        <a class="btn" href="#/reminders">{t('garage.reminders')}</a>
        <a class="btn" href="#/services">{t('garage.services')}</a>
        <a class="btn" href="#/issues">{t('garage.issues')}</a>
      </div>
    </Page>
  );
}

// ---------------- photos & signature ----------------

/** Shrinks a camera photo to fit the server limit (about 110 KB as text). */
async function shrinkPhoto(file: File): Promise<string> {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  let max = 720;
  let out = '';
  for (let i = 0; i < 5; i++) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', 0.6);
    if (out.length < 110_000) break;
    max = Math.round(max * 0.75);
  }
  URL.revokeObjectURL(url);
  return out;
}

function PhotoStrip(props: { ids: string[] }) {
  const photos = useLive(() => db.photo.bulkGet(props.ids), [props.ids.join(',')], [] as any[]);
  const [big, setBig] = useState<string | null>(null);
  if (!props.ids.length) return null;
  return (
    <>
      <div class="photos">
        {photos.map((p) => (p?.dataUrl ? <button type="button" onClick={() => setBig(p.dataUrl)}><img src={p.dataUrl} alt="" /></button> : <span class="ph-wait" />))}
      </div>
      {big && (
        <div class="sheet-bg" onClick={() => setBig(null)}>
          <img src={big} alt="" style={{ maxWidth: '96vw', maxHeight: '90vh', margin: 'auto', borderRadius: 8 }} />
        </div>
      )}
    </>
  );
}

function SignaturePad(props: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0d1726';
  }, []);
  const pos = (e: PointerEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  };
  const down = (e: PointerEvent) => {
    drawing.current = true;
    ref.current!.setPointerCapture(e.pointerId);
    const ctx = ref.current!.getContext('2d')!;
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    drawn.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (drawn.current) props.onChange(ref.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    drawn.current = false;
    props.onChange(null);
  };
  return (
    <div>
      <canvas ref={ref} width={480} height={180} class="signature" onPointerDown={down as any} onPointerMove={move as any} onPointerUp={up} onPointerLeave={up} aria-label={t('garage.signature')} />
      <button type="button" class="btn small" onClick={clear}>{t('garage.clear')}</button>
    </div>
  );
}

// ---------------- arrival ----------------

export function JobNewPage() {
  const s = useSession();
  const garage = useGarage();
  const vehicles = useVehicles();
  const [plate, setPlate] = useState('');
  const [v, setV] = useState({ make: '', model: '', year: '', color: '', vin: '' });
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [f, setF] = useState({ contactName: '', contactPhone: '', km: '', fuel: 4, keyTag: '', complaint: '', damage: '', poNumber: '', promised: '' });
  const [items, setItems] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const cleanPlate = plate.trim().toUpperCase().replace(/\s+/g, ' ');
  const found = cleanPlate.length >= 3 ? vehicles.find((x) => norm(x.plate).replace(/\s/g, '') === norm(cleanPlate).replace(/\s/g, '')) : undefined;
  const suggestions = cleanPlate.length >= 2 && !found ? vehicles.filter((x) => norm(x.plate).replace(/\s/g, '').includes(norm(cleanPlate).replace(/\s/g, ''))).slice(0, 5) : [];
  useEffect(() => {
    if (found?.customerId && !customer) setCustomer(s.customers.find((c) => c.id === found.customerId) ?? null);
  }, [found?.id]);
  if (!garage) return <Page title={t('garage.newJob')} back><div class="notice">{t('garage.noGarage')}</div></Page>;
  if (!s.can('job.create')) return <Page title={t('garage.newJob')} back><Empty>{t('error.forbidden')}</Empty></Page>;
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const km = parseInt(f.km.replace(/\D/g, '')) || 0;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!cleanPlate || !f.complaint.trim()) return;
    if (customer?.poRequired && !f.poNumber.trim()) return toast(t('garage.poMissing'), 'warning');
    setBusy(true);
    try {
      const vehicleId = found?.id ?? `v_${ulid()}`;
      if (!found) {
        await engine.patch('vehicle', vehicleId, s.user.id, { plate: cleanPlate, make: v.make.trim(), model: v.model.trim(), year: v.year.trim(), color: v.color.trim(), vin: v.vin.trim(), customerId: customer?.id ?? null, km, note: '', active: true });
      } else {
        const fields: Record<string, unknown> = {};
        if (km && km !== found.km) fields.km = km;
        if (customer && customer.id !== found.customerId) fields.customerId = customer.id;
        if (Object.keys(fields).length) await engine.patch('vehicle', vehicleId, s.user.id, fields);
      }
      const id = `j_${ulid()}`;
      const photoIds = photos.map((_, i) => `job_${id}_${i + 1}`);
      for (const [i, dataUrl] of photos.entries()) await engine.patch('photo', photoIds[i], s.user.id, { dataUrl });
      const no = await engine.nextNo('OR', garage.code);
      const job: Record<string, unknown> = {
        no,
        storeId: garage.id,
        vehicleId,
        customerId: customer?.id ?? null,
        status: 'arrived',
        arrivedAt: engine.now(),
        fuel: f.fuel,
        complaint: f.complaint.trim(),
        arrivalItems: items,
        photoIds,
        contactName: f.contactName.trim(),
        contactPhone: f.contactPhone.trim(),
        mechanicIds: [],
        needs: [],
      };
      if (km) job.km = km;
      if (f.keyTag.trim()) job.keyTag = f.keyTag.trim();
      if (f.damage.trim()) job.damage = f.damage.trim();
      if (f.poNumber.trim()) job.poNumber = f.poNumber.trim();
      if (f.promised) job.promisedAt = new Date(`${f.promised}T12:00:00`).getTime();
      await engine.patch('job', id, s.user.id, job);
      toast(t('garage.registered', { no }), 'success');
      go(`/job/${id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t('garage.newJob')} back="/garage">
      <form class="stack" onSubmit={submit}>
        <Field label={t('garage.plate')}>
          <input value={plate} onInput={(e) => setPlate(e.currentTarget.value)} placeholder={t('garage.platePh')} autoCapitalize="characters" required style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: 20 }} />
        </Field>
        {found && <div class="notice ok">{t('garage.found', { vehicle: vehicleLabel(found) })}</div>}
        {suggestions.length > 0 && (
          <div class="list">
            {suggestions.map((x) => (
              <button type="button" class="item" onClick={() => setPlate(x.plate)}>
                <div class="main"><div class="title">{x.plate}</div><div class="sub">{[x.make, x.model].join(' ')}</div></div>
              </button>
            ))}
          </div>
        )}
        {!found && (
          <>
            <div class="grid2">
              <Field label={t('garage.make')}><input value={v.make} onInput={(e) => setV({ ...v, make: e.currentTarget.value })} placeholder="Toyota" /></Field>
              <Field label={t('garage.model')}><input value={v.model} onInput={(e) => setV({ ...v, model: e.currentTarget.value })} placeholder="Hilux" /></Field>
              <Field label={t('garage.year')}><input value={v.year} inputMode="numeric" onInput={(e) => setV({ ...v, year: e.currentTarget.value })} /></Field>
              <Field label={t('garage.color')}><input value={v.color} onInput={(e) => setV({ ...v, color: e.currentTarget.value })} /></Field>
            </div>
            <Field label={t('garage.vin')}><input value={v.vin} onInput={(e) => setV({ ...v, vin: e.currentTarget.value })} autoCapitalize="characters" /></Field>
          </>
        )}
        <Group label={t('garage.owner')}>
          <button type="button" class="btn block" style={{ justifyContent: 'space-between' }} onClick={() => setPickCustomer(true)}>
            <span>{customer ? customer.name : t('garage.pickCustomer')}</span>
            {customer?.type && customer.type !== 'person' && <span class="tag info">{t(`customer.type.${customer.type}`)}</span>}
          </button>
        </Group>
        <div class="grid2">
          <Field label={t('garage.contactName')}><input value={f.contactName} onInput={(e) => set({ contactName: e.currentTarget.value })} /></Field>
          <Field label={t('garage.contactPhone')}><input value={f.contactPhone} inputMode="tel" placeholder="+243" onInput={(e) => set({ contactPhone: e.currentTarget.value })} /></Field>
        </div>
        {(customer?.type === 'ngo' || customer?.type === 'company' || customer?.poRequired) && (
          <Field label={t('garage.poNumber')}><input value={f.poNumber} onInput={(e) => set({ poNumber: e.currentTarget.value })} required={!!customer?.poRequired} /></Field>
        )}
        <div class="grid2">
          <Field label={t('garage.km')}><input value={f.km} inputMode="numeric" onInput={(e) => set({ km: e.currentTarget.value })} placeholder={found?.km ? String(found.km) : ''} /></Field>
          <Field label={t('garage.keyTag')}><input value={f.keyTag} onInput={(e) => set({ keyTag: e.currentTarget.value })} /></Field>
        </div>
        <Field label={`${t('garage.fuel')} : ${t('garage.fuelValue', { n: f.fuel })}`}>
          <input type="range" min={0} max={8} step={1} value={f.fuel} onInput={(e) => set({ fuel: Number(e.currentTarget.value) })} class="fuel" />
        </Field>
        <Field label={t('garage.complaint')}>
          <textarea value={f.complaint} onInput={(e) => set({ complaint: e.currentTarget.value })} placeholder={t('garage.complaintPh')} required />
        </Field>
        <Group label={t('garage.arrivalItems')}>
          <div class="chips wrap">
            {ARRIVAL_ITEMS.map((i) => (
              <button type="button" class={items.includes(i) ? 'on' : ''} aria-pressed={items.includes(i)} onClick={() => setItems(items.includes(i) ? items.filter((x) => x !== i) : [...items, i])}>
                {t(`garage.item.${i}`)}
              </button>
            ))}
          </div>
        </Group>
        <Field label={t('garage.damage')}>
          <textarea value={f.damage} onInput={(e) => set({ damage: e.currentTarget.value })} placeholder={t('garage.damagePh')} />
        </Field>
        <Group label={t('garage.photos')} hint={t('garage.photoHint')}>
          <div class="photos">
            {photos.map((p, i) => (
              <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                <img src={p} alt="" />
              </button>
            ))}
            {photos.length < 6 && (
              <label class="ph-add">
                <Icon.plus />
                <span>{t('garage.addPhoto')}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) setPhotos([...photos, await shrinkPhoto(file)]);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            )}
          </div>
        </Group>
        <Field label={t('garage.promisedAt')}><input type="date" value={f.promised} onInput={(e) => set({ promised: e.currentTarget.value })} /></Field>
        <button class="btn primary block" disabled={busy || !cleanPlate || !f.complaint.trim()}>{busy ? t('common.wait') : t('garage.register')}</button>
      </form>
      {pickCustomer && <CustomerSheet onClose={() => setPickCustomer(false)} onPick={(c) => { setCustomer(c); setPickCustomer(false); }} />}
    </Page>
  );
}

// ---------------- job page ----------------

type Tab = 'arrival' | 'check' | 'work' | 'money' | 'exit';

export function JobPage(props: { id: string; tab?: string | null }) {
  const s = useSession();
  const job = useLive(() => db.job.get(props.id) as Promise<Job | undefined>, [props.id], undefined);
  const vehicle = useLive(() => (job ? (db.vehicle.get(job.vehicleId) as Promise<Vehicle | undefined>) : Promise.resolve(undefined)), [job?.vehicleId], undefined);
  const issues = useJobIssues(job?.id);
  const reversed = useReversedIds();
  const invoice = useJobInvoice(job?.id, reversed);
  const canMoney = s.can('job.invoice') || s.can('job.price');
  const [tab, setTab] = useState<Tab>((props.tab as Tab) || 'arrival');
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!job) return <Page title={t('garage.title')} back="/garage"><Empty>{t('common.notFound')}</Empty></Page>;
  const garage = s.stores.find((x) => x.id === job.storeId) ?? s.store;
  const customer = s.customers.find((c) => c.id === job.customerId) ?? null;
  const parts = jobParts(issues, reversed);
  const est = jobEstimate(job, parts, s.productById);
  const open = OPEN_STATUSES.includes(job.status);
  const works = s.can('job.work') && (s.user.role === 'owner' || s.user.storeId === job.storeId);
  const setStatus = async (status: JobStatus) => {
    await engine.patch('job', job.id, s.user.id, { status });
    toast(t('garage.statusChanged', { no: job.no, status: t(`garage.status.${status}`) }), status === 'cancelled' ? 'warning' : 'info');
  };
  const next: JobStatus | null =
    job.status === 'arrived' ? 'diagnosis' : job.status === 'approved' ? 'in_progress' : job.status === 'in_progress' ? 'ready' : job.status === 'waiting_parts' ? 'in_progress' : null;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'arrival', label: t('garage.tab.arrival') },
    { value: 'check', label: t('garage.tab.check') },
    { value: 'work', label: t('garage.tab.work') },
    ...(canMoney ? [{ value: 'money' as Tab, label: t('garage.tab.money') }] : []),
    { value: 'exit', label: t('garage.tab.exit') },
  ];
  const ctx = { job, vehicle, customer, garage, parts, est, invoice, issues, works };

  return (
    <Page title={`${vehicle?.plate ?? ''} · ${job.no}`} back="/garage">
      <div class="headline">
        <div class="label">{[vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(' ')}{customer ? ` · ${customer.name}` : ''}</div>
        <div class="row" style={{ gap: 6, marginTop: 4 }}>
          {statusTag(job.status)}
          <span class="muted">{t('garage.daysLong', { n: daysIn(job, engine.now()) })}</span>
          {job.promisedAt && open && <span class={job.promisedAt < engine.now() ? 'tag bad' : 'tag info'}>{t('garage.promisedAt')} : {fmtDate(job.promisedAt)}</span>}
        </div>
      </div>
      {needsReapproval(job, est.totalUSD) && open && <div class="notice bad" style={{ marginBottom: 10 }}>{t('garage.reapproveHint', { approved: fmtUSD(job.approvedTotalUSD ?? 0) })}</div>}
      {works && open && (
        <div class="row" style={{ marginBottom: 12 }}>
          {next && (
            <button class="btn dark grow" onClick={() => setStatus(next)}>
              {t(`garage.next.${next}`)}
            </button>
          )}
          {job.status === 'in_progress' && <button class="btn" onClick={() => setStatus('waiting_parts')}>{t('garage.next.waiting_parts')}</button>}
        </div>
      )}
      <div class="tabs-scroll">
        <Seg value={tab} options={tabs} onChange={setTab} />
      </div>
      <div style={{ marginTop: 12 }}>
        {tab === 'arrival' && <ArrivalTab {...ctx} />}
        {tab === 'check' && <CheckTab {...ctx} />}
        {tab === 'work' && <WorkTab {...ctx} />}
        {tab === 'money' && canMoney && <MoneyTab {...ctx} />}
        {tab === 'exit' && <ExitTab {...ctx} />}
      </div>
      {works && open && s.can('job.price') && !invoice && (
        <div style={{ marginTop: 24 }}>
          {confirmCancel ? (
            <div class="notice bad stack">
              <span>{t('garage.cancelConfirm', { no: job.no })}</span>
              <div class="row">
                <button class="btn" onClick={() => setConfirmCancel(false)}>{t('common.no')}</button>
                <button class="btn danger solid grow" onClick={() => setStatus('cancelled')}>{t('garage.cancelJob')}</button>
              </div>
            </div>
          ) : (
            <button class="btn danger block" onClick={() => setConfirmCancel(true)}>{t('garage.cancelJob')}</button>
          )}
        </div>
      )}
    </Page>
  );
}

interface Ctx {
  job: Job;
  vehicle?: Vehicle;
  customer: Customer | null;
  garage: Store;
  parts: JobPart[];
  est: { labourUSD: number; partsUSD: number; totalUSD: number };
  invoice?: JobInvoice;
  issues: Issue[];
  works: boolean;
}

function ArrivalTab({ job, vehicle, customer, garage }: Ctx) {
  const s = useSession();
  const card = jobCardText(t, { job, vehicle, customer, store: garage });
  const to = job.contactPhone || customer?.phone;
  return (
    <>
      <table class="facts">
        <tbody>
          <tr><th>{t('garage.arrivalAt')}</th><td class="n wrap">{fmtDateTime(job.arrivedAt)}</td></tr>
          {(job.contactName || job.contactPhone) && <tr><th>{t('garage.contactName')}</th><td class="n wrap">{[job.contactName, job.contactPhone].filter(Boolean).join(' · ')}</td></tr>}
          {job.km != null && <tr><th>{t('garage.km')}</th><td class="n">{job.km.toLocaleString('fr-FR')} km</td></tr>}
          {job.fuel != null && <tr><th>{t('garage.fuel')}</th><td class="n"><span class="fuel-gauge"><i style={{ width: `${(job.fuel / 8) * 100}%` }} /></span> {job.fuel}/8</td></tr>}
          {job.keyTag && <tr><th>{t('garage.keyTag')}</th><td class="n"><b>{job.keyTag}</b></td></tr>}
          {job.poNumber && <tr><th>{t('garage.poNumber')}</th><td class="n wrap">{job.poNumber}</td></tr>}
        </tbody>
      </table>
      <Section title={t('garage.complaint')} />
      <p style={{ whiteSpace: 'pre-wrap' }}>{job.complaint}</p>
      {!!job.arrivalItems?.length && (
        <>
          <Section title={t('garage.arrivalItems')} />
          <div class="chips wrap">{job.arrivalItems.map((i) => <span class="tag info">{t(`garage.item.${i}`)}</span>)}</div>
        </>
      )}
      {job.damage && (
        <>
          <Section title={t('garage.damage')} />
          <p style={{ whiteSpace: 'pre-wrap' }}>{job.damage}</p>
        </>
      )}
      {!!job.photoIds?.length && (
        <>
          <Section title={t('garage.photos')} />
          <PhotoStrip ids={job.photoIds} />
        </>
      )}
      <div class="grid2" style={{ marginTop: 16 }}>
        <button class="btn" onClick={() => printText(card)}><Icon.print />{t('garage.printCard')}</button>
        <button class="btn wa" onClick={() => sendWhatsApp({ kind: 'garage', to, text: card })}><Icon.whatsapp />{t('garage.sendCard')}</button>
      </div>
      {vehicle && <a class="btn block" style={{ marginTop: 8 }} href={`#/vehicle/${vehicle.id}`}>{t('garage.vehicleHistory')}</a>}
    </>
  );
}

function CheckTab({ job, works }: Ctx) {
  const s = useSession();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [diag, setDiag] = useState<string | null>(null);
  const sum = checklistSummary(job);
  const mechanics = s.users.filter((u) => u.active && u.storeId === job.storeId && (u.role === 'mechanic' || u.role === 'manager'));
  const setCheck = (item: string, st: CheckState) => {
    const cur = (job as any)[checkKey(item)] as { s: CheckState; note?: string } | undefined;
    const note = notes[item] ?? cur?.note;
    engine.patch('job', job.id, s.user.id, { [checkKey(item)]: note ? { s: st, note } : { s: st } });
  };
  const saveNote = (item: string) => {
    const cur = (job as any)[checkKey(item)] as { s: CheckState; note?: string } | undefined;
    if (!cur || notes[item] === undefined || notes[item] === (cur.note ?? '')) return;
    engine.patch('job', job.id, s.user.id, { [checkKey(item)]: notes[item] ? { s: cur.s, note: notes[item] } : { s: cur.s } });
  };
  const toggleMechanic = (id: string) => {
    const cur = job.mechanicIds ?? [];
    engine.patch('job', job.id, s.user.id, { mechanicIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const saveDiag = async () => {
    if (diag === null) return;
    await engine.patch('job', job.id, s.user.id, { diagnosis: diag.trim() });
    setDiag(null);
    toast(t('toast.updated', { what: t('garage.diagnosis') }), 'info');
  };
  const done = CHECK_ITEMS.length - sum.todo;
  return (
    <>
      <p class="muted">{t('garage.checkProgress', { done, total: CHECK_ITEMS.length, fix: sum.fix, watch: sum.watch })}</p>
      <div class="progress"><i style={{ width: `${(done / CHECK_ITEMS.length) * 100}%` }} /></div>
      <Section title={t('garage.mechanics')} />
      <div class="chips wrap">
        {mechanics.map((u) => (
          <button disabled={!works} class={job.mechanicIds?.includes(u.id) ? 'on' : ''} aria-pressed={!!job.mechanicIds?.includes(u.id)} onClick={() => toggleMechanic(u.id)}>{u.name}</button>
        ))}
      </div>
      {CHECKLIST.map((g) => (
        <>
          <Section title={t(`garage.group.${g.group}`)} />
          <div class="list">
            {g.items.map((item) => {
              const cur = (job as any)[checkKey(item)] as { s: CheckState; note?: string } | undefined;
              return (
                <div class="check-row">
                  <div class="ck-name">{t(`ck.${item}`)}</div>
                  <div class="ck-btns" role="group" aria-label={t(`ck.${item}`)}>
                    {(['ok', 'watch', 'fix', 'na'] as CheckState[]).map((st) => (
                      <button type="button" disabled={!works} class={`ck ${st} ${cur?.s === st ? 'on' : ''}`} aria-pressed={cur?.s === st} onClick={() => setCheck(item, st)}>
                        {t(`garage.check.${st}`)}
                      </button>
                    ))}
                  </div>
                  {(cur?.s === 'fix' || cur?.s === 'watch') && (
                    <input
                      class="ck-note"
                      value={notes[item] ?? cur.note ?? ''}
                      disabled={!works}
                      placeholder={t('garage.checkNote')}
                      onInput={(e) => setNotes({ ...notes, [item]: e.currentTarget.value })}
                      onBlur={() => saveNote(item)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      ))}
      <Section title={t('garage.diagnosis')} />
      <textarea value={diag ?? job.diagnosis ?? ''} disabled={!works} onInput={(e) => setDiag(e.currentTarget.value)} placeholder={t('garage.diagnosisPh')} style={{ minHeight: 120 }} />
      {works && diag !== null && <button class="btn primary block" style={{ marginTop: 8 }} onClick={saveDiag}>{t('common.save')}</button>}
    </>
  );
}

function WorkTab({ job, vehicle, parts, works, garage, issues }: Ctx) {
  const s = useSession();
  const services = useServices().filter((x) => x.active).sort((a, b) => a.name.localeCompare(b.name));
  const stock = useStock(null);
  const canPrice = s.can('job.price') && works;
  const [labour, setLabour] = useState<LabourLine[] | null>(null);
  const [needs, setNeeds] = useState<NeedLine[] | null>(null);
  const [q, setQ] = useState('');
  const [free, setFree] = useState({ name: '', price: '' });
  const L = labour ?? job.labour ?? [];
  const N = needs ?? job.needs ?? [];
  const progress = needsProgress({ needs: N }, parts);
  const dirty = labour !== null || needs !== null;
  const stockAt = (storeId: string, pid: string) => stock.get(`${storeId}:${pid}`) ?? 0;
  const bestStore = (pid: string) => {
    if (stockAt(garage.id, pid) > 0) return garage.id;
    const shops = s.stores.filter((x) => x.kind !== 'garage').sort((a, b) => stockAt(b.id, pid) - stockAt(a.id, pid));
    return shops[0]?.id ?? garage.id;
  };
  const save = async () => {
    const fields: Record<string, unknown> = {};
    if (labour !== null) fields.labour = labour.filter((l) => l.name.trim() && l.qty > 0);
    if (needs !== null) fields.needs = needs.filter((n) => n.qty > 0);
    await engine.patch('job', job.id, s.user.id, fields);
    setLabour(null);
    setNeeds(null);
    toast(t('toast.updated', { what: job.no }), 'info');
  };
  const takeFromShelf = async () => {
    const lines = progress
      .filter((n) => n.fromStoreId === garage.id && n.missing > 0)
      .map((n) => {
        const p = s.productById.get(n.productId)!;
        return { productId: n.productId, name: p.name, qty: n.missing, unitUSD: p.priceUSD, costUSD: p.costUSD };
      });
    if (!lines.length) return;
    const no = await engine.nextNo('BS', garage.code);
    await engine.createDoc<Issue>('issue', s.user.id, garage.id, { no, jobId: job.id, jobNo: job.no, lines, takenBy: s.user.name });
    toast(t('issue.saved', { no }), 'success');
  };
  const ask = (storeId: string) => {
    const shop = s.stores.find((x) => x.id === storeId);
    const lines = progress.filter((n) => n.fromStoreId === storeId && n.missing > 0).map((n) => `• ${n.missing} x ${s.productById.get(n.productId)?.name ?? n.productId}`);
    sendWhatsApp({ kind: 'garage', to: shop?.phone, text: t('garage.askText', { no: job.no, vehicle: vehicleLabel(vehicle), lines: lines.join('\n') }) });
  };
  const waitingShops = [...new Set(progress.filter((n) => n.missing > 0 && n.fromStoreId !== garage.id).map((n) => n.fromStoreId))];
  const shelfMissing = progress.some((n) => n.fromStoreId === garage.id && n.missing > 0);
  const garageParts = parts.filter((p) => (p.byStore[garage.id] ?? 0) > 0);

  return (
    <>
      <Section title={t('garage.labour')} />
      {!canPrice && <p class="muted">{t('garage.onlyChief')}</p>}
      <div class="list">
        {L.map((l, i) => (
          <div class="item" style={{ cursor: 'default' }}>
            <div class="main">
              <div class="title">{l.name}</div>
              {canPrice ? (
                <div class="row" style={{ marginTop: 4 }}>
                  <input style={{ width: 72 }} inputMode="decimal" value={String(l.qty)} aria-label={t('garage.qty')} onInput={(e) => setLabour(L.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.currentTarget.value.replace(',', '.')) || 0) } : x)))} />
                  <span class="muted">×</span>
                  <input style={{ width: 100 }} inputMode="decimal" value={String(l.unitUSD)} aria-label={t('garage.price')} onInput={(e) => setLabour(L.map((x, j) => (j === i ? { ...x, unitUSD: Math.max(0, Number(e.currentTarget.value.replace(',', '.')) || 0) } : x)))} />
                  <button type="button" class="btn small danger" onClick={() => setLabour(L.filter((_, j) => j !== i))}>{t('common.remove')}</button>
                </div>
              ) : (
                <div class="sub">{l.qty !== 1 ? `${l.qty} × ` : ''}{fmtUSD(l.unitUSD)}</div>
              )}
            </div>
            <div class="end usd">{fmtUSD(round2(l.qty * l.unitUSD))}</div>
          </div>
        ))}
      </div>
      {canPrice && (
        <div class="stack" style={{ marginTop: 8 }}>
          <select
            value=""
            aria-label={t('garage.addService')}
            onChange={(e) => {
              const sv = services.find((x) => x.id === e.currentTarget.value);
              if (sv) setLabour([...L, { serviceId: sv.id, name: sv.name, qty: 1, unitUSD: sv.priceUSD }]);
            }}
          >
            <option value="">{t('garage.addService')}…</option>
            {services.map((sv) => <option value={sv.id}>{sv.name} · {fmtUSD(sv.priceUSD)}</option>)}
          </select>
          <div class="row">
            <input class="grow" style={{ flex: 1 }} value={free.name} placeholder={t('garage.freeLinePh')} aria-label={t('garage.freeLine')} onInput={(e) => setFree({ ...free, name: e.currentTarget.value })} />
            <input style={{ width: 90 }} inputMode="decimal" value={free.price} placeholder="$" aria-label={t('garage.price')} onInput={(e) => setFree({ ...free, price: e.currentTarget.value })} />
            <button
              type="button"
              class="btn small"
              disabled={!free.name.trim()}
              onClick={() => {
                setLabour([...L, { serviceId: null, name: free.name.trim(), qty: 1, unitUSD: Math.max(0, Number(free.price.replace(',', '.')) || 0) }]);
                setFree({ name: '', price: '' });
              }}
            >
              <Icon.plus />
            </button>
          </div>
        </div>
      )}

      <Section title={t('garage.needs')} />
      <p class="muted">{t('garage.needsHint')}</p>
      <div class="list">
        {progress.map((n, i) => {
          const p = s.productById.get(n.productId);
          return (
            <div class="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <div class="main" style={{ minWidth: 180 }}>
                <div class="title">{p?.name ?? n.productId}</div>
                <div class="sub">{p?.ref} · {fmtUSD(p?.priceUSD ?? 0)}</div>
                <div class="row" style={{ gap: 4, marginTop: 4 }}>
                  {n.issued > 0 && <span class="tag ok">{t('garage.issued', { n: n.issued })}</span>}
                  {n.missing > 0 && <span class="tag warn">{t('garage.missing', { n: n.missing })}</span>}
                </div>
              </div>
              {works ? (
                <div class="row" style={{ gap: 6 }}>
                  <input style={{ width: 64 }} inputMode="numeric" value={String(n.qty)} aria-label={t('garage.qty')} onInput={(e) => setNeeds(N.map((x, j) => (j === i ? { ...x, qty: Math.max(0, parseInt(e.currentTarget.value) || 0) } : x)))} />
                  <select style={{ width: 'auto', maxWidth: 170 }} value={n.fromStoreId} aria-label={t('garage.from')} onChange={(e) => setNeeds(N.map((x, j) => (j === i ? { ...x, fromStoreId: e.currentTarget.value } : x)))}>
                    {s.stores.map((x) => <option value={x.id}>{x.name.replace(/^Inter-Diesel\s+/i, '')} ({stockAt(x.id, n.productId)})</option>)}
                  </select>
                  <button type="button" class="btn small danger" onClick={() => setNeeds(N.filter((_, j) => j !== i))} aria-label={t('common.remove')}><Icon.x /></button>
                </div>
              ) : (
                <div class="end">{n.qty} · {s.stores.find((x) => x.id === n.fromStoreId)?.name}</div>
              )}
            </div>
          );
        })}
      </div>
      {works && (
        <div style={{ marginTop: 8 }}>
          <ProductPick
            q={q}
            setQ={setQ}
            products={s.products}
            exclude={new Set(N.map((n) => n.productId))}
            onPick={(p) => setNeeds([...N, { productId: p.id, qty: 1, fromStoreId: bestStore(p.id) }])}
          />
        </div>
      )}
      {dirty && works && <button class="btn primary block" style={{ marginTop: 10 }} onClick={save}>{t('garage.saveWork')}</button>}
      {!dirty && works && shelfMissing && s.can('issue.create') && (
        <button class="btn dark block" style={{ marginTop: 10 }} onClick={takeFromShelf}>{t('garage.takeFromShelf')}</button>
      )}
      {!dirty && waitingShops.map((id) => (
        <button class="btn wa block" style={{ marginTop: 8 }} onClick={() => ask(id)}>
          <Icon.whatsapp />
          {t('garage.askShop')} · {s.stores.find((x) => x.id === id)?.name}
        </button>
      ))}

      <Section title={t('garage.received')} />
      <div class="list">
        {parts.map((p) => (
          <div class="item" style={{ cursor: 'default' }}>
            <div class="main">
              <div class="title">{p.qty} × {p.name}</div>
              <div class="sub">{Object.entries(p.byStore).filter(([, q]) => q).map(([id, q]) => `${s.stores.find((x) => x.id === id)?.name.replace(/^Inter-Diesel\s+/i, '') ?? id}: ${q}`).join(' · ')}</div>
            </div>
            <div class="end usd">{fmtUSD(round2(p.qty * p.unitUSD))}</div>
          </div>
        ))}
        {!parts.length && <Empty>{t('garage.noParts')}</Empty>}
      </div>
      {works && garageParts.length > 0 && s.can('issue.create') && s.storeId === garage.id && (
        <a class="btn block" style={{ marginTop: 8 }} href={`#/issue/new?job=${job.id}&return=1`}>{t('garage.returnParts')}</a>
      )}
      <IssueList issues={issues} />
    </>
  );
}

function IssueList(props: { issues: Issue[] }) {
  const s = useSession();
  const reversed = useReversedIds();
  if (!props.issues.length) return null;
  return (
    <>
      <Section title={t('garage.issues')} />
      <div class="list">
        {[...props.issues].sort((a, b) => b.at - a.at).map((x) => (
          <a class="item" href={`#/issue/${x.id}`}>
            <div class="main">
              <div class="title">
                {x.no} {x.returned && <span class="tag info">{t('move.issue_return')}</span>} {reversed.has(x.id) && <span class="tag bad">{t('reverse.tag')}</span>}
              </div>
              <div class="sub">{fmtDateTime(x.at)} · {s.stores.find((st) => st.id === x.storeId)?.name} · {x.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}

function MoneyTab({ job, vehicle, customer, garage, parts, est, invoice, works }: Ctx) {
  const s = useSession();
  const [approval, setApproval] = useState({ by: customer?.name ?? job.contactName ?? '', via: 'whatsapp' as NonNullable<Job['approvedVia']>, po: job.poNumber ?? '' });
  const [discount, setDiscount] = useState('');
  const [po, setPo] = useState(job.poNumber ?? '');
  const [sheet, setSheet] = useState<null | 'pay' | 'customer'>(null);
  const [payCustomer, setPayCustomer] = useState<Customer | null>(customer);
  const canPrice = s.can('job.price') && works;
  const quote = quoteText(t, { job, vehicle, customer, store: garage, parts, products: s.productById, rate: s.rate });
  const to = customer?.phone || job.contactPhone;
  const lines = invoiceLines(job, parts, s.productById);
  const gross = round2(lines.reduce((a, l) => a + round2(l.qty * l.unitUSD), 0));
  const disc = Math.min(gross, Math.max(0, round2(Number(discount.replace(',', '.')) || 0)));
  const total = round2(gross - disc);

  const sendQuote = async () => {
    sendWhatsApp({ kind: 'garage', to, text: quote });
    if (canPrice) {
      const fields: Record<string, unknown> = { quoteSentAt: engine.now() };
      if (job.status === 'arrived' || job.status === 'diagnosis') fields.status = 'quote';
      await engine.patch('job', job.id, s.user.id, fields);
    }
  };
  const approve = async (e: Event) => {
    e.preventDefault();
    if (!approval.by.trim()) return;
    const fields: Record<string, unknown> = { approvedTotalUSD: est.totalUSD, approvedAt: engine.now(), approvedBy: approval.by.trim(), approvedVia: approval.via };
    if (approval.po.trim() && approval.po.trim() !== job.poNumber) fields.poNumber = approval.po.trim();
    if (['arrived', 'diagnosis', 'quote'].includes(job.status)) fields.status = 'approved';
    await engine.patch('job', job.id, s.user.id, fields);
    toast(t('garage.approvedToast', { amount: fmtUSD(est.totalUSD) }), 'success');
  };
  const finish = async (payments: Payment[]) => {
    if (payCustomer?.poRequired && !po.trim()) return toast(t('garage.poMissing'), 'warning');
    const paid = round2(payments.reduce((a, p) => a + p.amountUSD, 0));
    let change = round2(Math.max(0, paid - total));
    if (change < 50 / s.rate && payments.some((p) => p.currency === 'CDF')) change = 0;
    const no = await engine.nextNo('FG', garage.code);
    const inv = await engine.createDoc<JobInvoice>('job_invoice', s.user.id, garage.id, {
      no,
      jobId: job.id,
      jobNo: job.no,
      vehicleId: job.vehicleId,
      customerId: payCustomer?.id ?? null,
      poNumber: po.trim() || undefined,
      rate: s.rate,
      lines,
      discountUSD: disc,
      totalUSD: total,
      payments,
      changeUSD: change,
    });
    const fields: Record<string, unknown> = { invoiceId: inv.id };
    if (job.status !== 'delivered') fields.status = 'ready';
    if (!job.customerId && payCustomer) fields.customerId = payCustomer.id;
    await engine.patch('job', job.id, s.user.id, fields);
    setSheet(null);
    toast(t('garage.invoiceDone', { no }), 'success');
  };

  if (invoice) {
    const text = invoiceText(t, { inv: invoice, vehicle, customer: s.customers.find((c) => c.id === invoice.customerId) ?? null, store: garage });
    return (
      <>
        <div class="headline">
          <div class="label">{t('garage.invoiced', { no: invoice.no, amount: fmtUSD(invoice.totalUSD) })}</div>
          <div class="big">{fmtUSD(invoice.totalUSD)}</div>
          <div class="cdf">{fmtCDF(usdToCdf(invoice.totalUSD, invoice.rate))} · {fmtDateTime(invoice.at)}</div>
        </div>
        <table class="facts">
          <tbody>
            {invoice.lines.map((l) => (
              <tr>
                <td>{l.qty} × {l.name}{l.kind === 'labour' && <div class="muted">{t('garage.labour')}</div>}</td>
                <td class="n">{fmtUSD(round2(l.qty * l.unitUSD))}</td>
              </tr>
            ))}
            {invoice.discountUSD > 0 && <tr><td>{t('cart.discount')}</td><td class="n">-{fmtUSD(invoice.discountUSD)}</td></tr>}
            {invoice.payments.map((p) => (
              <tr><th>{t(`pay.${p.method}`)}</th><td class="n">{p.currency === 'USD' ? fmtUSD(p.amount) : fmtCDF(p.amount)}</td></tr>
            ))}
            {invoice.poNumber && <tr><th>{t('garage.poNumber')}</th><td class="n wrap">{invoice.poNumber}</td></tr>}
          </tbody>
        </table>
        <div class="grid2" style={{ marginTop: 12 }}>
          <button class="btn" onClick={() => printText(text)}><Icon.print />{t('garage.invoicePrint')}</button>
          <button class="btn wa" onClick={() => sendWhatsApp({ kind: 'garage', to, text })}><Icon.whatsapp />{t('garage.invoiceShare')}</button>
        </div>
        <ReverseControl kind="job_invoice" id={invoice.id} block />
      </>
    );
  }

  return (
    <>
      <Section title={t('garage.estimate')} />
      <table class="facts">
        <tbody>
          <tr><th>{t('garage.labour')}</th><td class="n">{fmtUSD(est.labourUSD)}</td></tr>
          <tr><th>{t('garage.parts')}</th><td class="n">{fmtUSD(est.partsUSD)}</td></tr>
          <tr class="total"><td>{t('garage.total')}</td><td class="n">{fmtUSD(est.totalUSD)} <span class="cdf">{fmtCDF(usdToCdf(est.totalUSD, s.rate))}</span></td></tr>
        </tbody>
      </table>
      {job.quoteSentAt && <p class="muted">{t('garage.quoteSent', { at: fmtDateTime(job.quoteSentAt) })}</p>}
      <button class="btn wa block" style={{ marginTop: 8 }} onClick={sendQuote} disabled={est.totalUSD <= 0}>
        <Icon.whatsapp />
        {t('garage.sendQuote')}
      </button>

      <Section title={t('garage.approval')} />
      {job.approvedAt && (
        <div class={needsReapproval(job, est.totalUSD) ? 'notice bad' : 'notice ok'}>
          {t('garage.approved', { amount: fmtUSD(job.approvedTotalUSD ?? 0), name: job.approvedBy ?? '', via: t(`garage.via.${job.approvedVia ?? 'in_person'}`), at: fmtDateTime(job.approvedAt) })}
        </div>
      )}
      {canPrice && (!job.approvedAt || needsReapproval(job, est.totalUSD)) && (
        <form class="stack" style={{ marginTop: 8 }} onSubmit={approve}>
          <div class="grid2">
            <Field label={t('garage.approvedBy')}><input value={approval.by} onInput={(e) => setApproval({ ...approval, by: e.currentTarget.value })} required /></Field>
            <Field label={t('garage.approvedVia')}>
              <select value={approval.via} onChange={(e) => setApproval({ ...approval, via: e.currentTarget.value as any })}>
                {(['whatsapp', 'phone', 'in_person', 'purchase_order'] as const).map((v) => <option value={v}>{t(`garage.via.${v}`)}</option>)}
              </select>
            </Field>
          </div>
          {(approval.via === 'purchase_order' || customer?.poRequired) && (
            <Field label={t('garage.poNumber')}><input value={approval.po} onInput={(e) => setApproval({ ...approval, po: e.currentTarget.value })} required /></Field>
          )}
          <button class="btn dark block" disabled={est.totalUSD <= 0}>{t('garage.approve')} · {fmtUSD(est.totalUSD)}</button>
        </form>
      )}

      {s.can('job.invoice') && works && (
        <>
          <Section title={t('garage.invoice')} />
          {!lines.length ? (
            <Empty>{t('garage.nothingToInvoice')}</Empty>
          ) : (
            <div class="stack">
              <table class="facts">
                <tbody>
                  {lines.map((l) => (
                    <tr>
                      <td>{l.qty} × {l.name}{l.kind === 'labour' && <div class="muted">{t('garage.labour')}</div>}</td>
                      <td class="n">{fmtUSD(round2(l.qty * l.unitUSD))}</td>
                    </tr>
                  ))}
                  <tr class="total"><td>{t('garage.total')}</td><td class="n">{fmtUSD(total)}</td></tr>
                </tbody>
              </table>
              {needsProgress(job, parts).some((n) => n.missing > 0) && <div class="notice warn">{t('garage.partsMissing', { n: needsProgress(job, parts).reduce((a, n) => a + n.missing, 0) })}</div>}
              <div class="grid2">
                {s.can('job.price') && <Field label={t('garage.discount')}><input inputMode="decimal" value={discount} onInput={(e) => setDiscount(e.currentTarget.value)} /></Field>}
                <Field label={t('garage.poNumber')}><input value={po} onInput={(e) => setPo(e.currentTarget.value)} required={!!payCustomer?.poRequired} /></Field>
              </div>
              <button class="btn primary block" disabled={total <= 0} onClick={() => setSheet('pay')}>{t('garage.makeInvoice')} · {fmtUSD(total)}</button>
            </div>
          )}
        </>
      )}
      {sheet === 'pay' && (
        <MixedSheet total={total} customer={payCustomer} onClose={() => setSheet(null)} onBack={() => setSheet(null)} onPickCustomer={() => setSheet('customer')} onConfirm={finish} confirmLabel={t('garage.confirmInvoice')} />
      )}
      {sheet === 'customer' && <CustomerSheet onClose={() => setSheet('pay')} onPick={(c) => { setPayCustomer(c); setSheet('pay'); }} />}
    </>
  );
}

function ExitTab({ job, vehicle, customer, garage, invoice, works }: Ctx) {
  const s = useSession();
  const [f, setF] = useState({ to: job.contactName || customer?.name || '', km: job.km ? String(job.km) : '', nextKm: '', nextDate: '' });
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const km = parseInt(f.km) || 0;
    setF((x) => ({ ...x, nextKm: x.nextKm || (km ? String(km + 5000) : ''), nextDate: x.nextDate || new Date(engine.now() + 180 * DAY_MS).toISOString().slice(0, 10) }));
  }, []);
  if (job.status === 'delivered') {
    return (
      <>
        <div class="notice ok">{t('garage.delivered', { at: fmtDateTime(job.deliveredAt ?? 0), name: job.deliveredTo ?? '' })}</div>
        {job.signature && <img src={job.signature} alt={t('garage.signature')} class="signature-img" />}
        {job.exitKm != null && <p>{t('garage.exitKm')} : {job.exitKm.toLocaleString('fr-FR')} km</p>}
        {(job.nextServiceKm || job.nextServiceAt) && <p>{t('garage.nextService')} : {[job.nextServiceKm ? `${job.nextServiceKm.toLocaleString('fr-FR')} km` : '', job.nextServiceAt ? fmtDate(job.nextServiceAt) : ''].filter(Boolean).join(' · ')}</p>}
      </>
    );
  }
  if (job.status === 'cancelled') return <div class="notice bad">{t('garage.status.cancelled')}</div>;
  if (!invoice) return <div class="notice warn">{t('garage.needInvoice')}</div>;
  if (!works) return <Empty>{t('error.forbidden')}</Empty>;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!f.to.trim() || !sig) return;
    setBusy(true);
    const exitKm = parseInt(f.km) || undefined;
    const nextKm = parseInt(f.nextKm) || null;
    const nextAt = f.nextDate ? new Date(`${f.nextDate}T12:00:00`).getTime() : null;
    const fields: Record<string, unknown> = { status: 'delivered', deliveredAt: engine.now(), deliveredTo: f.to.trim(), signature: sig, nextServiceKm: nextKm, nextServiceAt: nextAt };
    if (exitKm) fields.exitKm = exitKm;
    await engine.patch('job', job.id, s.user.id, fields);
    if (vehicle) {
      const vf: Record<string, unknown> = { nextServiceKm: nextKm, nextServiceAt: nextAt };
      if (exitKm && exitKm >= (vehicle.km ?? 0)) vf.km = exitKm;
      await engine.patch('vehicle', vehicle.id, s.user.id, vf);
    }
    toast(t('garage.deliveredToast', { vehicle: vehicle?.plate ?? job.no }), 'success');
    setBusy(false);
    go('/garage');
  };
  return (
    <form class="stack" onSubmit={submit}>
      <div class="grid2">
        <Field label={t('garage.deliveredTo')}><input value={f.to} onInput={(e) => setF({ ...f, to: e.currentTarget.value })} required /></Field>
        <Field label={t('garage.exitKm')}><input inputMode="numeric" value={f.km} onInput={(e) => setF({ ...f, km: e.currentTarget.value })} /></Field>
      </div>
      <Group label={t('garage.signature')}>
        <SignaturePad onChange={setSig} />
      </Group>
      <Section title={t('garage.nextService')} />
      <div class="grid2">
        <Field label={t('garage.nextKm')}><input inputMode="numeric" value={f.nextKm} onInput={(e) => setF({ ...f, nextKm: e.currentTarget.value })} /></Field>
        <Field label={t('garage.nextDate')}><input type="date" value={f.nextDate} onInput={(e) => setF({ ...f, nextDate: e.currentTarget.value })} /></Field>
      </div>
      <button class="btn primary block" disabled={busy || !sig || !f.to.trim()}>{t('garage.deliver')}</button>
    </form>
  );
}

// ---------------- vehicles & reminders ----------------

export function VehiclesPage() {
  const s = useSession();
  const vehicles = useVehicles();
  const [q, setQ] = useState('');
  const dq = norm(useDebounced(q)).replace(/\s/g, '');
  const now = engine.now();
  const list = vehicles
    .filter((v) => v.active !== false)
    .filter((v) => !dq || norm(`${v.plate}${v.make}${v.model}${s.customers.find((c) => c.id === v.customerId)?.name ?? ''}`).replace(/\s/g, '').includes(dq))
    .sort((a, b) => a.plate.localeCompare(b.plate))
    .slice(0, 100);
  return (
    <Page title={t('garage.vehicles')} actions={s.can('job.create') && <a class="btn primary" href="#/job/new"><Icon.plus />{t('garage.newJob')}</a>}>
      <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('garage.searchPh')} aria-label={t('garage.searchPh')} />
      <div class="list" style={{ marginTop: 8 }}>
        {list.map((v) => {
          const due = serviceDue(v, now);
          return (
            <a class="item" href={`#/vehicle/${v.id}`}>
              <div class="main">
                <div class="title">{v.plate} <span class="muted" style={{ fontWeight: 500 }}>{[v.make, v.model].filter(Boolean).join(' ')}</span></div>
                <div class="sub">{s.customers.find((c) => c.id === v.customerId)?.name ?? '—'}{v.km ? ` · ${v.km.toLocaleString('fr-FR')} km` : ''}</div>
              </div>
              {due && <span class={`tag ${due === 'overdue' ? 'bad' : 'warn'}`}>{t(`garage.${due}`)}</span>}
            </a>
          );
        })}
        {!list.length && <Empty>{t('garage.vehicleNone')}</Empty>}
      </div>
    </Page>
  );
}

export function VehiclePage(props: { id: string }) {
  const s = useSession();
  const garage = useGarage();
  const v = useLive(() => db.vehicle.get(props.id) as Promise<Vehicle | undefined>, [props.id], undefined);
  const jobs = useLive(() => db.job.where('vehicleId').equals(props.id).toArray() as Promise<Job[]>, [props.id], [] as Job[]);
  const [edit, setEdit] = useState<Partial<Vehicle> | null>(null);
  const [pick, setPick] = useState(false);
  if (!v) return <Page title={t('garage.vehicle')} back="/vehicles"><Empty>{t('common.notFound')}</Empty></Page>;
  const customer = s.customers.find((c) => c.id === (edit?.customerId !== undefined ? edit.customerId : v.customerId));
  const due = serviceDue(v, engine.now());
  const save = async (e: Event) => {
    e.preventDefault();
    if (!edit) return;
    const changed = Object.fromEntries(Object.entries(edit).filter(([k, x]) => JSON.stringify((v as any)[k]) !== JSON.stringify(x)));
    if (Object.keys(changed).length) await engine.patch('vehicle', v.id, s.user.id, changed);
    notifySave(v.plate, v, changed);
    setEdit(null);
  };
  const val = { ...v, ...(edit ?? {}) };
  return (
    <Page title={v.plate} back="/vehicles" actions={s.can('vehicle.edit') && !edit && <button class="btn" onClick={() => setEdit({})}>{t('common.edit')}</button>}>
      {edit ? (
        <form class="stack" onSubmit={save}>
          <Field label={t('garage.plate')}><input value={val.plate} onInput={(e) => setEdit({ ...edit, plate: e.currentTarget.value.toUpperCase() })} required /></Field>
          <div class="grid2">
            <Field label={t('garage.make')}><input value={val.make} onInput={(e) => setEdit({ ...edit, make: e.currentTarget.value })} /></Field>
            <Field label={t('garage.model')}><input value={val.model} onInput={(e) => setEdit({ ...edit, model: e.currentTarget.value })} /></Field>
            <Field label={t('garage.year')}><input value={val.year ?? ''} onInput={(e) => setEdit({ ...edit, year: e.currentTarget.value })} /></Field>
            <Field label={t('garage.color')}><input value={val.color ?? ''} onInput={(e) => setEdit({ ...edit, color: e.currentTarget.value })} /></Field>
          </div>
          <Field label={t('garage.vin')}><input value={val.vin ?? ''} onInput={(e) => setEdit({ ...edit, vin: e.currentTarget.value })} /></Field>
          <Group label={t('garage.owner')}>
            <button type="button" class="btn block" onClick={() => setPick(true)}>{customer?.name ?? t('garage.pickCustomer')}</button>
          </Group>
          <label class="check"><input type="checkbox" checked={val.active !== false} onChange={(e) => setEdit({ ...edit, active: e.currentTarget.checked })} />{t('common.active')}</label>
          <div class="row">
            <button type="button" class="btn" onClick={() => setEdit(null)}>{t('common.back')}</button>
            <button class="btn primary grow">{t('common.save')}</button>
          </div>
          {pick && <CustomerSheet onClose={() => setPick(false)} onPick={(c) => { setEdit({ ...edit, customerId: c.id }); setPick(false); }} />}
        </form>
      ) : (
        <>
          <div class="headline">
            <div class="label">{[v.make, v.model, v.year, v.color].filter(Boolean).join(' · ')}</div>
            <div>{customer ? <a href={`#/customer/${customer.id}`}>{customer.name}</a> : '—'}</div>
            {v.km != null && <div class="muted">{t('garage.lastKm', { km: v.km.toLocaleString('fr-FR') })}</div>}
          </div>
          {(v.nextServiceKm || v.nextServiceAt) && (
            <div class={`notice ${due === 'overdue' ? 'bad' : due === 'soon' ? 'warn' : ''}`}>
              {t('garage.nextServiceShort', { when: [v.nextServiceKm ? `${v.nextServiceKm.toLocaleString('fr-FR')} km` : '', v.nextServiceAt ? fmtDate(v.nextServiceAt) : ''].filter(Boolean).join(' · ') })}
              {due && garage && (
                <button class="btn wa small" style={{ marginLeft: 8 }} onClick={() => sendWhatsApp({ kind: 'garage', to: customer?.phone, text: reminderText(t, { vehicle: v, customer, store: garage }) })}>
                  <Icon.whatsapp />{t('garage.remind')}
                </button>
              )}
            </div>
          )}
          {v.vin && <p class="muted">VIN {v.vin}</p>}
        </>
      )}
      <Section title={t('garage.vehicleHistory')} />
      <div class="list">
        {[...jobs].sort((a, b) => b.arrivedAt - a.arrivedAt).map((j) => (
          <a class="item" href={`#/job/${j.id}`}>
            <div class="main">
              <div class="title">{j.no} · {fmtDate(j.arrivedAt)}</div>
              <div class="sub">{j.complaint}</div>
            </div>
            {statusTag(j.status)}
          </a>
        ))}
        {!jobs.length && <Empty>{t('garage.none')}</Empty>}
      </div>
    </Page>
  );
}

export function RemindersPage() {
  const s = useSession();
  const garage = useGarage();
  const vehicles = useVehicles();
  const now = engine.now();
  const due = vehicles
    .filter((v) => v.active !== false)
    .map((v) => ({ v, d: serviceDue(v, now) }))
    .filter((x) => x.d)
    .sort((a, b) => (a.v.nextServiceAt ?? Infinity) - (b.v.nextServiceAt ?? Infinity));
  return (
    <Page title={t('garage.reminders')}>
      <div class="list">
        {due.map(({ v, d }) => {
          const c = s.customers.find((x) => x.id === v.customerId);
          return (
            <div class="item" style={{ cursor: 'default' }}>
              <a class="main" href={`#/vehicle/${v.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <div class="title">{v.plate} <span class={`tag ${d === 'overdue' ? 'bad' : 'warn'}`}>{t(`garage.${d}`)}</span></div>
                <div class="sub">{c?.name ?? '—'} · {[v.nextServiceKm ? `${v.nextServiceKm.toLocaleString('fr-FR')} km` : '', v.nextServiceAt ? fmtDate(v.nextServiceAt) : ''].filter(Boolean).join(' · ')}</div>
              </a>
              {garage && (
                <button class="btn wa small" onClick={() => sendWhatsApp({ kind: 'garage', to: c?.phone, text: reminderText(t, { vehicle: v, customer: c, store: garage }) })}>
                  <Icon.whatsapp />
                  {t('garage.remind')}
                </button>
              )}
            </div>
          );
        })}
        {!due.length && <Empty>{t('garage.remindersNone')}</Empty>}
      </div>
    </Page>
  );
}

// ---------------- services catalogue ----------------

export function ServicesPage() {
  const s = useSession();
  const services = useServices();
  const [f, setF] = useState({ name: '', category: '', price: '' });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const can = s.can('service.manage');
  const add = async (e: Event) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    await engine.patch('service', `sv_${ulid()}`, s.user.id, { name: f.name.trim(), category: f.category.trim(), priceUSD: Math.max(0, Number(f.price.replace(',', '.')) || 0), active: true });
    toast(t('toast.created', { what: f.name.trim() }), 'success');
    setF({ name: '', category: f.category, price: '' });
  };
  const savePrice = async (sv: Service) => {
    const v = edits[sv.id];
    if (v === undefined) return;
    const n = Math.max(0, Number(v.replace(',', '.')) || 0);
    if (n !== sv.priceUSD) {
      await engine.patch('service', sv.id, s.user.id, { priceUSD: n });
      toast(t('toast.updated', { what: sv.name }), 'info');
    }
    const { [sv.id]: _, ...rest } = edits;
    setEdits(rest);
  };
  const toggle = async (sv: Service) => {
    await engine.patch('service', sv.id, s.user.id, { active: !sv.active });
    notifySave(sv.name, sv, { active: !sv.active });
  };
  const groups = new Map<string, Service[]>();
  for (const sv of [...services].sort((a, b) => a.name.localeCompare(b.name))) groups.set(sv.category || '—', [...(groups.get(sv.category || '—') ?? []), sv]);
  return (
    <Page title={t('garage.services')}>
      <p class="muted">{t('garage.servicesHint')}</p>
      {[...groups].map(([cat, list]) => (
        <>
          <Section title={cat} />
          <div class="list">
            {list.map((sv) => (
              <div class="item" style={{ cursor: 'default', opacity: sv.active ? 1 : 0.55 }}>
                <div class="main"><div class="title">{sv.name}</div></div>
                {can ? (
                  <>
                    <input style={{ width: 90 }} inputMode="decimal" value={edits[sv.id] ?? String(sv.priceUSD)} aria-label={`${t('garage.price')} ${sv.name}`} onInput={(e) => setEdits({ ...edits, [sv.id]: e.currentTarget.value })} onBlur={() => savePrice(sv)} />
                    <button class="btn small" onClick={() => toggle(sv)}>{sv.active ? t('garage.disable') : t('garage.enable')}</button>
                  </>
                ) : (
                  <div class="end usd">{fmtUSD(sv.priceUSD)}</div>
                )}
              </div>
            ))}
          </div>
        </>
      ))}
      {can && (
        <form class="stack" style={{ marginTop: 16 }} onSubmit={add}>
          <Section title={t('garage.addToCatalogue')} />
          <Field label={t('garage.serviceName')}><input value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} required /></Field>
          <div class="grid2">
            <Field label={t('garage.serviceCategory')}>
              <input list="sv-cats" value={f.category} onInput={(e) => setF({ ...f, category: e.currentTarget.value })} />
              <datalist id="sv-cats">{[...groups.keys()].map((c) => <option value={c} />)}</datalist>
            </Field>
            <Field label={t('garage.price')}><input inputMode="decimal" value={f.price} onInput={(e) => setF({ ...f, price: e.currentTarget.value })} /></Field>
          </div>
          <button class="btn primary block">{t('common.save')}</button>
        </form>
      )}
    </Page>
  );
}

// ---------------- bons de sortie ----------------

/** Needs of open garage jobs that the current store must hand out. */
export function usePendingIssues(storeId: string) {
  const jobs = useLive(() => db.job.toArray() as Promise<Job[]>, [], [] as Job[]);
  const issues = useLive(() => db.issue.toArray() as Promise<Issue[]>, [], [] as Issue[]);
  const reversed = useReversedIds();
  return useMemo(() => {
    const byJob = new Map<string, Issue[]>();
    for (const x of issues) byJob.set(x.jobId, [...(byJob.get(x.jobId) ?? []), x]);
    return jobs
      .filter((j) => OPEN_STATUSES.includes(j.status))
      .map((j) => ({ job: j, missing: needsProgress(j, jobParts(byJob.get(j.id) ?? [], reversed)).filter((n) => n.fromStoreId === storeId && n.missing > 0) }))
      .filter((x) => x.missing.length);
  }, [jobs, issues, reversed, storeId]);
}

export function IssuesPage() {
  const s = useSession();
  const pending = usePendingIssues(s.storeId);
  const vehicles = useVehicles();
  const recent = useLive(() => db.issue.where('storeId').equals(s.storeId).reverse().sortBy('at') as Promise<Issue[]>, [s.storeId], [] as Issue[]);
  return (
    <Page title={t('garage.issues')}>
      <Section title={t('issue.pending')} />
      <div class="list">
        {pending.map(({ job, missing }) => {
          const v = vehicles.find((x) => x.id === job.vehicleId);
          return (
            <a class="item" href={`#/issue/new?job=${job.id}`}>
              <div class="main">
                <div class="title">{job.no} · {v?.plate}</div>
                <div class="sub">{missing.map((n) => `${n.missing}× ${s.productById.get(n.productId)?.name ?? n.productId}`).join(', ')}</div>
              </div>
              <span class="tag warn">{missing.reduce((a, n) => a + n.missing, 0)}</span>
            </a>
          );
        })}
        {!pending.length && <Empty>{t('issue.pendingNone')}</Empty>}
      </div>
      <Section title={t('issue.recent')} />
      <div class="list">
        {recent.slice(0, 40).map((x) => (
          <a class="item" href={`#/issue/${x.id}`}>
            <div class="main">
              <div class="title">{x.no} {x.returned && <span class="tag info">{t('move.issue_return')}</span>}</div>
              <div class="sub">{fmtDateTime(x.at)} · {x.jobNo} · {x.takenBy}</div>
            </div>
          </a>
        ))}
        {!recent.length && <Empty>{t('issue.none')}</Empty>}
      </div>
    </Page>
  );
}

export function IssueNewPage(props: { jobId: string | null; returning: boolean }) {
  const s = useSession();
  const job = useLive(() => (props.jobId ? (db.job.get(props.jobId) as Promise<Job | undefined>) : Promise.resolve(undefined)), [props.jobId], undefined);
  const vehicle = useLive(() => (job ? (db.vehicle.get(job.vehicleId) as Promise<Vehicle | undefined>) : Promise.resolve(undefined)), [job?.vehicleId], undefined);
  const issues = useJobIssues(job?.id);
  const reversed = useReversedIds();
  const stock = useStock(s.storeId);
  const [lines, setLines] = useState<{ productId: string; qty: number }[] | null>(null);
  const [takenBy, setTakenBy] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const parts = jobParts(issues, reversed);
  const initial = useMemo(() => {
    if (!job) return [];
    if (props.returning) return parts.filter((p) => (p.byStore[s.storeId] ?? 0) > 0).map((p) => ({ productId: p.productId, qty: 0 }));
    return needsProgress(job, parts).filter((n) => n.fromStoreId === s.storeId && n.missing > 0).map((n) => ({ productId: n.productId, qty: n.missing }));
  }, [job?.id, issues.length]);
  const L = lines ?? initial;
  if (!s.can('issue.create')) return <Page title={t('issue.new')} back><Empty>{t('error.forbidden')}</Empty></Page>;
  if (!job) return <Page title={t('issue.new')} back><Empty>{t('common.notFound')}</Empty></Page>;
  const maxReturn = (pid: string) => parts.find((p) => p.productId === pid)?.byStore[s.storeId] ?? 0;

  const submit = async (e: Event) => {
    e.preventDefault();
    const ls = L.filter((l) => l.qty > 0);
    if (!ls.length || takenBy.trim().length < 2) return;
    if (props.returning && ls.some((l) => l.qty > maxReturn(l.productId))) return toast(t('error.return_more_than_issued'), 'error');
    setBusy(true);
    const no = await engine.nextNo(props.returning ? 'RP' : 'BS', s.store.code);
    const doc = await engine.createDoc<Issue>('issue', s.user.id, s.storeId, {
      no,
      jobId: job.id,
      jobNo: job.no,
      returned: props.returning || undefined,
      lines: ls.map((l) => {
        const p = s.productById.get(l.productId)!;
        const prev = parts.find((x) => x.productId === l.productId);
        return { productId: p.id, name: p.name, qty: l.qty, unitUSD: props.returning && prev ? prev.unitUSD : p.priceUSD, costUSD: props.returning && prev ? prev.costUSD : p.costUSD };
      }),
      takenBy: takenBy.trim(),
      note: note.trim() || undefined,
    });
    toast(t(props.returning ? 'issue.returned' : 'issue.saved', { no }), 'success');
    go(`/issue/${doc.id}`);
  };

  return (
    <Page title={props.returning ? t('issue.newReturn') : t('issue.new')} back>
      <div class="headline">
        <div class="label">{t('issue.forJob', { no: job.no })}</div>
        <div><b>{vehicleLabel(vehicle)}</b></div>
        <div class="muted">{s.store.name}</div>
      </div>
      <form class="stack" onSubmit={submit}>
        <Section title={t('issue.lines')} />
        <div class="list">
          {L.map((l, i) => {
            const p = s.productById.get(l.productId);
            const here = stock.get(l.productId) ?? 0;
            return (
              <div class="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div class="main" style={{ minWidth: 170 }}>
                  <div class="title">{p?.name}</div>
                  <div class="sub">{p?.ref} · {props.returning ? t('garage.issued', { n: maxReturn(l.productId) }) : t('issue.stockHere', { n: here })}</div>
                </div>
                <div class="stepper">
                  <button type="button" onClick={() => setLines(L.map((x, j) => (j === i ? { ...x, qty: Math.max(0, x.qty - 1) } : x)))} aria-label="-">−</button>
                  <input inputMode="numeric" value={String(l.qty)} aria-label={t('garage.qty')} onInput={(e) => setLines(L.map((x, j) => (j === i ? { ...x, qty: Math.max(0, parseInt(e.currentTarget.value) || 0) } : x)))} />
                  <button type="button" onClick={() => setLines(L.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))} aria-label="+">+</button>
                </div>
              </div>
            );
          })}
        </div>
        {!props.returning && <ProductPick q={q} setQ={setQ} products={s.products} exclude={new Set(L.map((l) => l.productId))} onPick={(p) => setLines([...L, { productId: p.id, qty: 1 }])} />}
        <Field label={t('issue.takenByLabel')}><input value={takenBy} onInput={(e) => setTakenBy(e.currentTarget.value)} required minLength={2} /></Field>
        <Field label={t('cart.note')}><input value={note} onInput={(e) => setNote(e.currentTarget.value)} /></Field>
        <button class="btn primary block" disabled={busy || !L.some((l) => l.qty > 0) || takenBy.trim().length < 2}>{props.returning ? t('issue.confirmReturn') : t('issue.confirm')}</button>
      </form>
    </Page>
  );
}

export function IssuePage(props: { id: string }) {
  const s = useSession();
  const x = useLive(() => db.issue.get(props.id) as Promise<Issue | undefined>, [props.id], undefined);
  const job = useLive(() => (x ? (db.job.get(x.jobId) as Promise<Job | undefined>) : Promise.resolve(undefined)), [x?.jobId], undefined);
  const vehicle = useLive(() => (job ? (db.vehicle.get(job.vehicleId) as Promise<Vehicle | undefined>) : Promise.resolve(undefined)), [job?.vehicleId], undefined);
  if (!x) return <Page title={t('kind.issue')} back><Empty>{t('common.notFound')}</Empty></Page>;
  const store = s.stores.find((st) => st.id === x.storeId) ?? s.store;
  const text = issueText(t, { issue: x, store, jobVehicle: vehicleLabel(vehicle), userName: s.users.find((u) => u.id === x.userId)?.name ?? '' });
  const garage = s.stores.find((st) => st.id === job?.storeId);
  return (
    <Page title={`${t('kind.issue')} ${x.no}`} back>
      <pre class="ticket">{text.replace(/\*/g, '')}</pre>
      <div class="grid2" style={{ marginTop: 12 }}>
        <button class="btn" onClick={() => printText(text)}><Icon.print />{t('issue.print')}</button>
        <button class="btn wa" onClick={() => sendWhatsApp({ kind: 'garage', to: garage?.phone, text })}><Icon.whatsapp />{t('issue.share')}</button>
      </div>
      {job && <a class="btn block" style={{ marginTop: 8 }} href={`#/job/${job.id}?tab=work`}>{t('garage.jobRef', { no: job.no })}</a>}
      <ReverseControl kind="issue" id={x.id} block />
    </Page>
  );
}
