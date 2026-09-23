import { useMemo, useState } from 'preact/hooks';
import { ulid } from 'ulid';
import { db, engine, go, t, toast, useLive, useSession } from '../state';
import { Empty, Field, Icon, Page, Section, Seg, norm, useDebounced } from '../ui';
import { customerBalances } from '../../shared/reports';
import { debtReminderText } from '../../shared/messages';
import { fmtCDF, fmtUSD, roundCdf, toUSD, usdToCdf } from '../../shared/money';
import { fmtDate, fmtDateTime } from '../../shared/time';
import type { Currency, Customer, LedgerEntry, Repayment } from '../../shared/types';
import { sendWhatsApp } from '../share';
import { useReversedIds } from './admin';

export function CustomersPage() {
  const s = useSession();
  const ledger = useLive(() => db.ledger.toArray() as Promise<LedgerEntry[]>, [], [] as LedgerEntry[]);
  const balances = useMemo(() => customerBalances(ledger, engine.now()), [ledger]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [tab, setTab] = useState<'debt' | 'all'>('debt');
  const [showInactive, setShowInactive] = useState(false);
  const list = s.customers
    .filter((c) => (showInactive ? !c.active : c.active) && (!dq || norm(`${c.name} ${c.phone ?? ''}`).includes(norm(dq))))
    .filter((c) => tab === 'all' || (balances.get(c.id)?.balanceUSD ?? 0) > 0.004)
    .sort((a, b) => (tab === 'debt' ? (balances.get(b.id)?.balanceUSD ?? 0) - (balances.get(a.id)?.balanceUSD ?? 0) : a.name.localeCompare(b.name)));
  const totalDebt = [...balances.values()].reduce((a, b) => a + Math.max(0, b.balanceUSD), 0);

  return (
    <Page
      title={t('customers.title')}
      actions={
        s.can('customer.edit') && (
          <a class="btn small dark" href="#/customer/new">
            <Icon.plus />
            {t('common.new')}
          </a>
        )
      }
    >
      <div class="headline">
        <div class="label">{t('customers.totalDebt')}</div>
        <div class="usd">{fmtUSD(totalDebt)} <span class="cdf">{fmtCDF(usdToCdf(totalDebt, s.rate))}</span></div>
      </div>
      <Seg value={tab} onChange={setTab} options={[{ value: 'debt', label: t('customers.withDebt') }, { value: 'all', label: t('customers.all') }]} />
      <input style={{ marginTop: 8 }} type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('customer.searchPh')} aria-label={t('customer.searchPh')} />
      {s.can('price.edit') && (
        <label class="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => { setShowInactive(e.currentTarget.checked); if (e.currentTarget.checked) setTab('all'); }} />
          {t('customers.showInactive')}
        </label>
      )}
      <div class="list" style={{ marginTop: 8 }}>
        {list.map((c) => {
          const b = balances.get(c.id);
          const old = b && (b.buckets.d61_90 > 0 || b.buckets.d90p > 0);
          return (
            <a class="item" href={`#/customer/${c.id}`}>
              <div class="main">
                <div class="title">{c.name}</div>
                <div class="sub">{c.phone}</div>
              </div>
              <div class="end">
                {b && b.balanceUSD > 0.004 ? <div class="usd">{fmtUSD(b.balanceUSD)}</div> : <span class="muted">{t('customers.noDebt')}</span>}
                {old && <span class="tag bad">{t('customers.old')}</span>}
              </div>
            </a>
          );
        })}
        {!list.length && <Empty>{tab === 'debt' ? t('customers.noneWithDebt') : t('customer.none')}</Empty>}
      </div>
      <a class="btn block" style={{ marginTop: 12 }} href="#/reports?tab=debts">{t('customers.agingLink')}</a>
    </Page>
  );
}

export function CustomerPage(props: { id: string }) {
  const s = useSession();
  const c = s.customers.find((x) => x.id === props.id);
  const ledger = useLive(() => db.ledger.where('customerId').equals(props.id).toArray() as Promise<LedgerEntry[]>, [props.id], [] as LedgerEntry[]);
  const bal = useMemo(() => customerBalances(ledger, engine.now()).get(props.id), [ledger]);
  const reversed = useReversedIds();
  const [method, setMethod] = useState<Repayment['method']>('cash');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  if (!c) return <Page title={t('customers.title')} back="/customers"><Empty>{t('common.notFound')}</Empty></Page>;
  const balance = bal?.balanceUSD ?? 0;
  const n = Math.max(0, Number(amount.replace(',', '.')) || 0);
  const amountUSD = toUSD(n, currency, s.rate);

  const repay = async (e: Event) => {
    e.preventDefault();
    if (n <= 0) return;
    setBusy(true);
    await engine.createDoc<Repayment>('repayment', s.user.id, s.storeId, { customerId: c.id, method, currency, amount: n, amountUSD, rate: s.rate });
    setAmount('');
    setBusy(false);
    toast(t('customer.repaid', { amount: currency === 'USD' ? fmtUSD(n) : fmtCDF(n) }));
  };
  const remind = () => sendWhatsApp({ kind: 'debt_reminder', to: c.phone, text: debtReminderText(t, c, balance, s.rate, s.store.name) });
  const all = () => setAmount(String(currency === 'USD' ? balance : roundCdf(balance * s.rate)));

  return (
    <Page title={c.name} back="/customers" actions={s.can('customer.edit') && <a class="btn small" href={`#/customer/${c.id}/edit`}>{t('common.edit')}</a>}>
      <div class="headline">
        <div class="label">{t('customer.balance')}</div>
        <div class={`big ${balance > 0.004 ? '' : 'pos'}`}>{fmtUSD(balance)}</div>
        <div class="cdf">{fmtCDF(usdToCdf(Math.max(0, balance), s.rate))}</div>
        {c.creditLimitUSD != null && <div class={balance > c.creditLimitUSD ? 'neg' : 'muted'}>{t('customer.limit', { amount: fmtUSD(c.creditLimitUSD) })}</div>}
      </div>
      {c.phone && (
        <div class="grid2">
          <a class="btn" href={`tel:${c.phone}`}><Icon.phone />{t('customer.call')}</a>
          <button class="btn wa" onClick={remind} disabled={balance <= 0.004}><Icon.whatsapp />{t('customer.remind')}</button>
        </div>
      )}
      {bal && balance > 0.004 && (
        <>
          <Section title={t('customer.aging')} />
          <table class="facts">
            <tbody>
              <tr><th>{t('aging.d0_30')}</th><td class="n">{fmtUSD(bal.buckets.d0_30)}</td></tr>
              <tr><th>{t('aging.d31_60')}</th><td class="n">{fmtUSD(bal.buckets.d31_60)}</td></tr>
              <tr><th>{t('aging.d61_90')}</th><td class={`n ${bal.buckets.d61_90 ? 'low' : ''}`}>{fmtUSD(bal.buckets.d61_90)}</td></tr>
              <tr><th>{t('aging.d90p')}</th><td class={`n ${bal.buckets.d90p ? 'neg' : ''}`}>{fmtUSD(bal.buckets.d90p)}</td></tr>
            </tbody>
          </table>
        </>
      )}
      {s.can('repay') && (
        <>
          <Section title={t('customer.repay')} />
          <form class="stack" onSubmit={repay}>
            <div class="grid2">
              <select value={method} onChange={(e) => setMethod(e.currentTarget.value as any)} aria-label={t('pay.method')}>
                {(['cash', 'mpesa', 'airtel', 'orange'] as const).map((m) => (
                  <option value={m}>{t(`pay.${m}`)}</option>
                ))}
              </select>
              <Seg value={currency} onChange={(v) => { setCurrency(v); setAmount(''); }} options={[{ value: 'USD', label: 'USD' }, { value: 'CDF', label: 'FC' }]} />
            </div>
            <div class="row">
              <input class="grow" style={{ flex: 1 }} inputMode="decimal" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} placeholder={t('pay.amount')} aria-label={t('pay.amount')} />
              <button type="button" class="btn small" onClick={all} disabled={balance <= 0}>{t('customer.all')}</button>
            </div>
            {currency === 'CDF' && n > 0 && <div class="muted">= {fmtUSD(amountUSD)}</div>}
            <button class="btn primary block" disabled={busy || n <= 0}>{t('customer.saveRepay')}</button>
          </form>
        </>
      )}
      <Section title={t('customer.history')} />
      <div class="list">
        {[...ledger].sort((a, b) => b.at - a.at).map((e) => {
          const canCancel = e.kind === 'repayment' && s.can('doc.reverse') && !reversed.has(e.ref);
          const href = e.kind === 'credit_sale' ? `#/sale/${e.ref}` : canCancel ? `#/reverse/repayment/${e.ref}` : undefined;
          return (
          <a class="item" href={href} style={{ cursor: href ? 'pointer' : 'default' }}>
            <div class="main">
              <div class="title">
                {t(`ledger.${e.kind}`)}
                {(e as any).pending ? <span class="tag warn" style={{ marginLeft: 6 }}>{t('sync.notSent')}</span> : null}
                {e.kind === 'repayment' && reversed.has(e.ref) ? <span class="tag" style={{ marginLeft: 6 }}>{t('reverse.tag')}</span> : null}
              </div>
              <div class="sub">{fmtDateTime(e.at)} · {s.stores.find((x) => x.id === e.storeId)?.name}{canCancel ? ` · ${t('reverse.tapToCancel')}` : ''}</div>
            </div>
            <div class={`end usd ${e.amountUSD < 0 ? 'pos' : ''}`}>{e.amountUSD > 0 ? '+' : ''}{fmtUSD(e.amountUSD)}</div>
          </a>
          );
        })}
        {!ledger.length && <Empty>{t('customer.noHistory')}</Empty>}
      </div>
      {c.note && <p class="muted">{c.note}</p>}
      {bal?.oldestUnpaidAt && <p class="muted">{t('customer.oldest', { date: fmtDate(bal.oldestUnpaidAt) })}</p>}
    </Page>
  );
}

export function CustomerEditPage(props: { id?: string }) {
  const s = useSession();
  const existing = props.id ? s.customers.find((c) => c.id === props.id) : undefined;
  const [f, setF] = useState<Omit<Customer, 'id'>>(existing ?? { name: '', phone: '', note: '', active: true });
  const set = (p: Partial<Customer>) => setF({ ...f, ...p });
  const save = async (e: Event) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    const id = props.id ?? `c_${ulid()}`;
    const fields: Record<string, unknown> = { ...f, name: f.name.trim(), phone: (f.phone ?? '').trim() };
    if (!s.can('price.edit')) delete fields.creditLimitUSD;
    const changed = existing ? Object.fromEntries(Object.entries(fields).filter(([k, v]) => JSON.stringify((existing as any)[k]) !== JSON.stringify(v))) : fields;
    if (Object.keys(changed).length) await engine.patch('customer', id, s.user.id, changed);
    toast(t('common.saved'));
    go(`/customer/${id}`);
  };
  return (
    <Page title={existing ? t('customer.edit') : t('customer.new')} back>
      <form class="stack" onSubmit={save}>
        <Field label={t('customer.name')}>
          <input value={f.name} onInput={(e) => set({ name: e.currentTarget.value })} required />
        </Field>
        <Field label={t('customer.phone')} hint={t('customer.phoneHint')}>
          <input value={f.phone} onInput={(e) => set({ phone: e.currentTarget.value })} inputMode="tel" placeholder="+243" />
        </Field>
        {s.can('price.edit') && (
          <Field label={t('customer.creditLimit')} hint={t('customer.creditLimitHint')}>
            <input inputMode="decimal" value={f.creditLimitUSD ?? ''} onInput={(e) => set({ creditLimitUSD: e.currentTarget.value === '' ? null : Math.max(0, Number(e.currentTarget.value) || 0) })} />
          </Field>
        )}
        <Field label={t('customer.note')}>
          <textarea value={f.note} onInput={(e) => set({ note: e.currentTarget.value })} />
        </Field>
        {existing && (
          <label class="check">
            <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.currentTarget.checked })} />
            {t('customer.active')}
          </label>
        )}
        <button class="btn primary block">{t('common.save')}</button>
      </form>
    </Page>
  );
}
