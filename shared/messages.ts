// Text of every WhatsApp message the app can send. Used by the share buttons
// today and by the WhatsApp Business API channel later, so both say the same thing.
import type { T } from './i18n';
import type { Customer, Product, Sale, Store, TransferRequest, TransferSend } from './types';
import type { DaySummary } from './reports';
import { fmtCDF, fmtUSD, usdToCdf } from './money';
import { fmtDate, fmtDateTime } from './time';

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

export function receiptText(t: T, sale: Sale, store: Store, sellerName: string, customer?: Customer | null): string {
  const lines: string[] = [];
  lines.push(`*${store.name}*`);
  if (store.address) lines.push(store.address);
  if (store.phone) lines.push(t('receipt.phone', { phone: store.phone }));
  lines.push('');
  lines.push(t('receipt.number', { no: sale.no }));
  lines.push(fmtDateTime(sale.at));
  lines.push(t('receipt.seller', { name: sellerName }));
  if (customer) lines.push(t('receipt.customer', { name: customer.name }));
  lines.push('------------------------------');
  for (const l of sale.lines) {
    lines.push(`${l.qty} x ${l.name}`);
    lines.push(`   ${l.ref}  ${fmtUSD(l.unitUSD)} = ${fmtUSD(l.qty * l.unitUSD)}`);
  }
  lines.push('------------------------------');
  if (sale.discountUSD > 0) lines.push(`${t('receipt.discount')}: -${fmtUSD(sale.discountUSD)}`);
  lines.push(`*${t('receipt.total')}: ${fmtUSD(sale.totalUSD)}*  (${fmtCDF(usdToCdf(sale.totalUSD, sale.rate))})`);
  for (const p of sale.payments) {
    const amt = p.currency === 'USD' ? fmtUSD(p.amount) : fmtCDF(p.amount);
    lines.push(`${t(`pay.${p.method}`)}: ${amt}`);
  }
  if (sale.changeUSD > 0) lines.push(`${t('receipt.change')}: ${fmtUSD(sale.changeUSD)}`);
  lines.push(t('receipt.rate', { rate: sale.rate }));
  lines.push('');
  lines.push(t('receipt.thanks'));
  return lines.join('\n');
}

export function dailySummaryText(t: T, s: DaySummary, storeName: string, sellerNames: Record<string, string>): string {
  const out: string[] = [];
  out.push(`*${t('wa.daily.title', { store: storeName, day: fmtDate(Date.parse(s.day)) })}*`);
  out.push(t('wa.daily.sales', { n: s.count, total: fmtUSD(s.totalUSD) }));
  out.push(t('wa.daily.margin', { margin: fmtUSD(s.marginUSD) }));
  for (const [k, v] of Object.entries(s.byMethod)) {
    const [m, c] = k.split(':');
    out.push(`• ${t(`pay.${m}`)} ${c === 'USD' ? fmtUSD(v) : fmtCDF(v)}`);
  }
  if (s.creditUSD) out.push(t('wa.daily.credit', { amount: fmtUSD(s.creditUSD) }));
  if (s.repaidUSD) out.push(t('wa.daily.repaid', { amount: fmtUSD(s.repaidUSD) }));
  if (s.voidedCount) out.push(t('wa.daily.voided', { n: s.voidedCount }));
  const sellers = Object.entries(s.bySeller).sort((a, b) => b[1].totalUSD - a[1].totalUSD);
  if (sellers.length) {
    out.push('');
    out.push(t('wa.daily.bySeller'));
    for (const [uid, v] of sellers) out.push(`• ${sellerNames[uid] ?? uid}: ${v.count} · ${fmtUSD(v.totalUSD)}`);
  }
  return out.join('\n');
}

export function lowStockText(t: T, storeName: string, items: { p: Product; qty: number; min: number }[]): string {
  const out = [`*${t('wa.low.title', { store: storeName })}*`];
  for (const { p, qty, min } of items) out.push(`• ${p.name} (${p.ref}): ${qty} / min ${min}`);
  return out.join('\n');
}

export function transferRequestText(t: T, r: TransferRequest, from: Store, to: Store, products: Map<string, Product>): string {
  const out = [`*${t('wa.request.title', { from: to.name, to: from.name })}*`];
  for (const l of r.lines) {
    const p = products.get(l.productId);
    out.push(`• ${l.qty} x ${p?.name ?? l.productId} (${p?.ref ?? ''})`);
  }
  if (r.note) out.push(r.note);
  return out.join('\n');
}

export function transferSendText(t: T, s: TransferSend, from: Store, to: Store, products: Map<string, Product>): string {
  const out = [`*${t('wa.send.title', { from: from.name, to: to.name })}*`, fmtDateTime(s.at)];
  for (const l of s.lines) {
    const p = products.get(l.productId);
    out.push(`• ${l.qty} x ${p?.name ?? l.productId} (${p?.ref ?? ''})`);
  }
  out.push(t('wa.send.footer'));
  return out.join('\n');
}

export function debtReminderText(t: T, c: Customer, balanceUSD: number, rate: number, storeName: string): string {
  return t('wa.debt.reminder', { name: c.name, usd: fmtUSD(balanceUSD), cdf: fmtCDF(usdToCdf(balanceUSD, rate)), store: storeName });
}

/** wa.me link. Phone numbers are normalised to digits only (international format). */
export function waLink(text: string, phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export { pad };
