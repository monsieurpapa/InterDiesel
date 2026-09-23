import type { Currency, Product } from './types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** CDF amounts are rounded up to the nearest 50 FC, as cash below that is rarely used. */
export const CDF_STEP = 50;
export function roundCdf(n: number): number {
  return Math.ceil(Math.round(n) / CDF_STEP) * CDF_STEP;
}

export function usdToCdf(usd: number, rate: number): number {
  return roundCdf(usd * rate);
}

export function toUSD(amount: number, currency: Currency, rate: number): number {
  return currency === 'USD' ? round2(amount) : round2(amount / rate);
}

export function productPriceCDF(p: Pick<Product, 'priceUSD' | 'priceCDF'>, rate: number): number {
  return p.priceCDF && p.priceCDF > 0 ? p.priceCDF : usdToCdf(p.priceUSD, rate);
}

const nbsp = ' ';
export function fmtUSD(n: number): string {
  const s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  return `${n < 0 ? '-' : ''}$${s}`;
}
export function fmtCDF(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  return `${n < 0 ? '-' : ''}${s}${nbsp}FC`;
}
export function fmt(n: number, c: Currency): string {
  return c === 'USD' ? fmtUSD(n) : fmtCDF(n);
}
