// End-of-day cash-drawer close: what the drawer and mobile-money accounts should
// hold (sales + repayments - refunds) against what is actually counted.
import { useState } from 'preact/hooks';
import { db, engine, t, toast, useLive, useSession } from '../state';
import { Empty, Field, Icon, Page, Section } from '../ui';
import { expectedDrawer, closeGaps } from '../../shared/reports';
import { fmt, fmtCDF, fmtUSD, round2 } from '../../shared/money';
import { dayKey, dayStart, DAY_MS, fmtDate, fmtDateTime } from '../../shared/time';
import type { CashClose, Currency, Repayment, Sale, SaleVoid } from '../../shared/types';
import { sendWhatsApp } from '../share';

const KEYS = ['cash:USD', 'cash:CDF', 'mpesa:USD', 'mpesa:CDF', 'airtel:USD', 'airtel:CDF', 'orange:USD', 'orange:CDF'];

export function CashPage() {
  const s = useSession();
  const [day, setDay] = useState(dayKey(engine.now()));
  const from = dayStart(day);
  const sales = useLive(() => db.sale.where('[storeId+at]').between([s.storeId, from], [s.storeId, from + DAY_MS]).toArray() as Promise<Sale[]>, [s.storeId, day], [] as Sale[]);
  const voids = useLive(() => db.sale_void.where('storeId').equals(s.storeId).toArray() as Promise<SaleVoid[]>, [s.storeId], [] as SaleVoid[]);
  const reps = useLive(() => db.repayment.where('storeId').equals(s.storeId).filter((r: Repayment) => r.at >= from && r.at < from + DAY_MS).toArray(), [s.storeId, day], [] as Repayment[]);
  const closes = useLive(() => db.cash_close.where('storeId').equals(s.storeId).toArray().then((x: CashClose[]) => x.sort((a, b) => b.at - a.at)), [s.storeId], [] as CashClose[]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const expected = expectedDrawer(day, s.storeId, sales, voids, reps);
  const keys = KEYS.filter((k) => k.startsWith('cash:') || (expected[k] ?? 0) !== 0);
  const done = closes.find((c) => c.day === day);
  if (!s.can('cash.close')) return <Page title={t('cash.title')} back><Empty>{t('error.forbidden')}</Empty></Page>;

  const cnt = (k: string) => Math.max(0, Number((counted[k] ?? '').replace(',', '.')) || 0);
  const submit = async (e: Event) => {
    e.preventDefault();
    const c: Record<string, number> = {};
    for (const k of keys) c[k] = counted[k] === undefined || counted[k] === '' ? round2(expected[k] ?? 0) : cnt(k);
    const doc = await engine.createDoc<CashClose>('cash_close', s.user.id, s.storeId, { day, expected: Object.fromEntries(keys.map((k) => [k, expected[k] ?? 0])), counted: c, note: note || undefined });
    toast(t('cash.saved'));
    setCounted({});
    share(doc);
  };
  const share = (c: CashClose) => {
    const gaps = closeGaps(c);
    const lines = [`*${t('cash.waTitle', { store: s.store.name, day: fmtDate(dayStart(c.day) + 3_600_000) })}*`];
    for (const k of Object.keys(c.expected)) {
      const [m, cur] = k.split(':');
      lines.push(`• ${t(`pay.${m}`)} ${cur}: ${fmt(c.counted[k] ?? 0, cur as Currency)} (${t('cash.expectedShort')} ${fmt(c.expected[k], cur as Currency)}${gaps[k] ? `, ${t('cash.gapShort')} ${fmt(gaps[k], cur as Currency)}` : ''})`);
    }
    if (c.note) lines.push(c.note);
    lines.push(t('cash.by', { name: s.user.name }));
    sendWhatsApp({ kind: 'daily_summary', text: lines.join('\n') });
  };

  return (
    <Page title={t('cash.title')} back>
      <Field label={t('common.day')}>
        <input type="date" value={day} max={dayKey(engine.now())} onChange={(e) => e.currentTarget.value && setDay(e.currentTarget.value)} />
      </Field>
      {done && (
        <div class="notice ok" style={{ marginTop: 10 }}>
          {t('cash.alreadyClosed', { at: fmtDateTime(done.at), name: s.users.find((u) => u.id === done.userId)?.name ?? '' })}
        </div>
      )}
      <form onSubmit={submit}>
        <table class="facts" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>{t('cash.where')}</th><th class="n">{t('cash.expected')}</th><th class="n">{t('cash.counted')}</th></tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const [m, cur] = k.split(':');
              const exp = expected[k] ?? 0;
              const gap = counted[k] ? round2(cnt(k) - exp) : 0;
              return (
                <tr>
                  <td>{t(`pay.${m}`)} {cur === 'USD' ? 'USD' : 'FC'}{gap !== 0 && <div class={gap < 0 ? 'neg' : 'pos'}><b>{t('cash.gap', { v: fmt(gap, cur as Currency) })}</b></div>}</td>
                  <td class="n">{fmt(exp, cur as Currency)}</td>
                  <td class="n"><input style={{ width: 110 }} inputMode="decimal" value={counted[k] ?? ''} placeholder={String(exp)} onInput={(e) => setCounted({ ...counted, [k]: e.currentTarget.value })} aria-label={`${t('cash.counted')} ${t(`pay.${m}`)} ${cur}`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p class="muted">{t('cash.hint')}</p>
        <Field label={t('cart.note')}>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </Field>
        <button class="btn primary block" style={{ marginTop: 10 }}>{t('cash.close')}</button>
      </form>
      <Section title={t('cash.history')} />
      <div class="list">
        {closes.slice(0, 30).map((c) => {
          const g = closeGaps(c);
          const bad = Object.values(g).some((v) => Math.abs(v) > 0.009);
          return (
            <button class="item" onClick={() => share(c)}>
              <div class="main">
                <div class="title">{fmtDate(dayStart(c.day) + 3_600_000)}</div>
                <div class="sub">{s.users.find((u) => u.id === c.userId)?.name} · {fmtUSD(c.counted['cash:USD'] ?? 0)} · {fmtCDF(c.counted['cash:CDF'] ?? 0)}</div>
              </div>
              {bad ? <span class="tag bad">{t('cash.withGap')}</span> : <span class="tag ok">{t('cash.balanced')}</span>}
              <Icon.whatsapp width={22} height={22} />
            </button>
          );
        })}
        {!closes.length && <Empty>{t('cash.none')}</Empty>}
      </div>
    </Page>
  );
}
