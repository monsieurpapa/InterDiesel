import { useState } from 'preact/hooks';
import { db, engine, go, t, toast, useLive, useSession } from '../state';
import { Empty, Field, Icon, Page, Section } from '../ui';
import { receiptText } from '../../shared/messages';
import { fmtCDF, fmtUSD, usdToCdf } from '../../shared/money';
import { fmtDateTime, dayKey, dayStart, fmtDate, DAY_MS } from '../../shared/time';
import { creditOf, voidIdFor } from '../../shared/derive';
import { collected } from '../../shared/reports';
import type { Sale, SaleVoid } from '../../shared/types';
import { printText, receiptImage, sendWhatsApp } from '../share';

export function ReceiptPage(props: { id: string; fresh?: boolean }) {
  const s = useSession();
  const sale = useLive(() => db.sale.get(props.id) as Promise<Sale | undefined>, [props.id], undefined);
  const voided = useLive(() => db.sale_void.get(voidIdFor(props.id)) as Promise<SaleVoid | undefined>, [props.id], undefined);
  const pending = useLive(() => db.outbox.where('opId').equals(props.id).count(), [props.id], 0);
  if (!sale) return <Page title={t('receipt.title')} back="/sales"><Empty>{t('common.notFound')}</Empty></Page>;
  const store = s.stores.find((x) => x.id === sale.storeId) ?? s.store;
  const seller = s.users.find((u) => u.id === sale.userId);
  const customer = sale.customerId ? s.customers.find((c) => c.id === sale.customerId) : null;
  const text = receiptText(t, sale, store, seller?.name ?? '', customer);

  const shareImage = async () => {
    const blob = await receiptImage(text);
    const r = await sendWhatsApp({ kind: 'receipt', text, file: { name: `recu-${sale.no}.png`, type: 'image/png', data: blob } });
    if (!r.ok) toast(t('share.failed'), 'error');
  };
  const sendToCustomer = () => sendWhatsApp({ kind: 'receipt', to: customer?.phone, text });

  return (
    <Page title={t('receipt.titleNo', { no: sale.no })} back={props.fresh ? undefined : '/sales'}>
      {props.fresh && <div class="notice ok" style={{ marginBottom: 12 }}><b>{t('receipt.saved')}</b> {pending ? t('receipt.willSync') : ''}</div>}
      {voided && <div class="notice bad" style={{ marginBottom: 12 }}>{t('receipt.voided', { reason: voided.reason })}</div>}
      <div class="headline">
        <div class="label">{fmtDateTime(sale.at)} · {seller?.name}</div>
        <div class="big">{fmtUSD(sale.totalUSD)}</div>
        <div class="cdf">{fmtCDF(usdToCdf(sale.totalUSD, sale.rate))} · {t('receipt.rateShort', { rate: sale.rate })}</div>
      </div>
      <div class="stack">
        <button class="btn wa block" onClick={shareImage}>
          <Icon.whatsapp />
          {t('receipt.shareImage')}
        </button>
        {customer?.phone && (
          <button class="btn wa block" onClick={sendToCustomer}>
            <Icon.whatsapp />
            {t('receipt.sendTo', { name: customer.name })}
          </button>
        )}
        <div class="grid2">
          <button class="btn" onClick={() => printText(text)}>
            <Icon.print />
            {t('receipt.print')}
          </button>
          <button class="btn primary" onClick={() => go('/')}>
            <Icon.cart />
            {t('receipt.newSale')}
          </button>
        </div>
      </div>
      <Section title={t('receipt.detail')} />
      <table class="facts">
        <tbody>
          {sale.lines.map((l) => (
            <tr>
              <td>
                <b>{l.qty} × {l.name}</b>
                <div class="muted">{l.ref} · {fmtUSD(l.unitUSD)}</div>
              </td>
              <td class="n">{fmtUSD(l.qty * l.unitUSD)}</td>
            </tr>
          ))}
          {sale.discountUSD > 0 && (
            <tr>
              <td>{t('cart.discount')}</td>
              <td class="n">-{fmtUSD(sale.discountUSD)}</td>
            </tr>
          )}
          {sale.payments.map((p) => (
            <tr>
              <th>{t(`pay.${p.method}`)}</th>
              <td class="n">{p.currency === 'USD' ? fmtUSD(p.amount) : fmtCDF(p.amount)}</td>
            </tr>
          ))}
          {sale.changeUSD > 0 && (
            <tr>
              <th>{t('pay.change')}</th>
              <td class="n">{fmtUSD(sale.changeUSD)}</td>
            </tr>
          )}
          {customer && (
            <tr>
              <th>{t('cart.customer')}</th>
              <td class="n"><a href={`#/customer/${customer.id}`}>{customer.name}</a></td>
            </tr>
          )}
          {sale.note && (
            <tr>
              <th>{t('cart.note')}</th>
              <td class="n">{sale.note}</td>
            </tr>
          )}
        </tbody>
      </table>
      {!voided && s.can('sale.void') && sale.storeId === s.storeId && (
        <button class="btn danger block" style={{ marginTop: 16 }} onClick={() => go(`/sale/${sale.id}/void`)}>
          {t('void.action')}
        </button>
      )}
    </Page>
  );
}

export function SalesPage() {
  const s = useSession();
  const [day, setDay] = useState(dayKey(engine.now()));
  const sales = useLive(
    () => db.sale.where('[storeId+at]').between([s.storeId, dayStart(day)], [s.storeId, dayStart(day) + DAY_MS]).reverse().toArray() as Promise<Sale[]>,
    [s.storeId, day],
    [] as Sale[],
  );
  const voids = useLive(() => db.sale_void.where('storeId').equals(s.storeId).toArray() as Promise<SaleVoid[]>, [s.storeId], [] as SaleVoid[]);
  const voided = new Set(voids.map((v) => v.saleId));
  const users = new Map(s.users.map((u) => [u.id, u.name]));
  const total = sales.filter((x) => !voided.has(x.id)).reduce((a, x) => a + x.totalUSD, 0);
  const shift = (d: number) => setDay(dayKey(dayStart(day) + d * DAY_MS + 3_600_000));

  return (
    <Page title={t('sales.title')} back="/reports">
      <div class="row">
        <button class="btn small" onClick={() => shift(-1)}>{t('common.prevDay')}</button>
        <input type="date" class="grow" style={{ flex: 1 }} value={day} onChange={(e) => e.currentTarget.value && setDay(e.currentTarget.value)} aria-label={t('common.day')} />
        <button class="btn small" onClick={() => shift(1)} disabled={day >= dayKey(engine.now())}>{t('common.nextDay')}</button>
      </div>
      <div class="headline">
        <div class="label">{fmtDate(dayStart(day) + 3_600_000)} · {t('sales.count', { n: sales.length - sales.filter((x) => voided.has(x.id)).length })}</div>
        <div class="usd">{fmtUSD(total)}</div>
      </div>
      <div class="list">
        {sales.map((x) => {
          const methods = Object.keys(collected(x)).map((k) => t(`pay.${k.split(':')[0]}`));
          if (creditOf(x) > 0) methods.push(t('pay.credit'));
          return (
            <a class="item" href={`#/sale/${x.id}`}>
              <div class="main">
                <div class="title">
                  {x.no} {voided.has(x.id) && <span class="tag bad">{t('sales.voided')}</span>}
                </div>
                <div class="sub">
                  {fmtDateTime(x.at).slice(11)} · {users.get(x.userId)} · {[...new Set(methods)].join(', ')}
                </div>
                <div class="sub">{x.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
              </div>
              <div class="end usd">{fmtUSD(x.totalUSD)}</div>
            </a>
          );
        })}
        {!sales.length && <Empty>{t('sales.none')}</Empty>}
      </div>
    </Page>
  );
}

export function VoidPage(props: { id: string }) {
  const s = useSession();
  const sale = useLive(() => db.sale.get(props.id) as Promise<Sale | undefined>, [props.id], undefined);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!sale) return <Page title={t('void.title')} back><Empty>{t('common.notFound')}</Empty></Page>;
  const credit = creditOf(sale);
  const paidNow = Math.max(0, sale.totalUSD - credit);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (reason.trim().length < 3) return;
    setBusy(true);
    try {
      await engine.createDoc<SaleVoid>('sale_void', s.user.id, sale.storeId, {
        id: voidIdFor(sale.id),
        saleId: sale.id,
        saleNo: sale.no,
        reason: reason.trim(),
        lines: sale.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        customerId: sale.customerId ?? null,
        creditUSD: credit,
        refundUSD: refund ? paidNow : 0,
      });
      toast(t('void.done'));
      go(`/sale/${sale.id}`);
    } catch (err) {
      toast(t('error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t('void.titleNo', { no: sale.no })} back>
      <form class="stack" onSubmit={submit}>
        <div class="notice warn">{t('void.explain')}</div>
        <Field label={t('void.reason')}>
          <input value={reason} onInput={(e) => setReason(e.currentTarget.value)} required minLength={3} placeholder={t('void.reasonPh')} />
        </Field>
        {paidNow > 0 && (
          <label class="check">
            <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.currentTarget.checked)} />
            {t('void.refund', { amount: fmtUSD(paidNow) })}
          </label>
        )}
        {credit > 0 && <p>{t('void.creditCancelled', { amount: fmtUSD(credit) })}</p>}
        <button class="btn danger solid block" disabled={busy || reason.trim().length < 3}>{t('void.confirm')}</button>
      </form>
    </Page>
  );
}
