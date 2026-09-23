import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { back, t, useSession } from './state';
import { fmtCDF, fmtUSD, productPriceCDF, usdToCdf } from '../shared/money';
import type { Product } from '../shared/types';

// ---------- icons (simple strokes, always shown with a text label) ----------
const P = (d: string) => (props: JSX.SVGAttributes<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...props}>
    <path d={d} />
  </svg>
);
export const Icon = {
  cart: P('M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20h.01M17 20h.01'),
  box: P('M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10'),
  people: P('M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8'),
  chart: P('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  menu: P('M4 6h16M4 12h16M4 18h16'),
  back: P('M15 18l-6-6 6-6'),
  scan: P('M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10'),
  share: P('M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5'),
  print: P('M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z'),
  plus: P('M12 5v14M5 12h14'),
  truck: P('M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01'),
  check: P('M5 12l5 5L20 7'),
  x: P('M6 6l12 12M18 6L6 18'),
  phone: P('M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z'),
  whatsapp: P('M3 21l1.6-4.8A8.5 8.5 0 1 1 7.8 19.4L3 21zM9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .9a4 4 0 0 1-2.2-2.2l.9-1-1-2L9 9.5z'),
  sync: P('M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5'),
  lock: P('M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4'),
  alert: P('M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'),
};

// ---------- layout ----------
export function Page(props: { title: string; back?: string | boolean; actions?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <div class={props.class}>
      <div class={props.back !== undefined && props.back !== false ? 'ph has-back' : 'ph'}>
        {props.back !== undefined && props.back !== false && (
          <button class="back" onClick={() => back(typeof props.back === 'string' ? props.back : '/')} aria-label={t('common.back')}>
            <Icon.back width={22} height={22} />
            <span>{t('common.back')}</span>
          </button>
        )}
        <h1>{props.title}</h1>
        {props.actions}
      </div>
      {props.children}
    </div>
  );
}

export function Section(props: { title: string; actions?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <>
      <div class="section">
        <h2>{props.title}</h2>
        {props.actions}
      </div>
      {props.children}
    </>
  );
}

export function Field(props: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <p class="muted" style={{ padding: '16px 4px' }}>{props.children}</p>;
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="tablist">
      {props.options.map((o) => (
        <button type="button" role="tab" aria-selected={o.value === props.value} class={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A bottom sheet. Only one is ever open: a sheet switches its own content instead of opening another. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; actions?: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, []);
  return (
    <div class="sheet-bg" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="sh-head">
          <h2>{props.title}</h2>
          {props.actions}
          <button class="btn small" onClick={props.onClose}>
            <Icon.x />
            {t('common.close')}
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

// ---------- money ----------
export function Money(props: { usd: number; rate?: number; cdf?: number; big?: boolean; inline?: boolean }) {
  const s = useSession();
  const cdf = props.cdf ?? usdToCdf(props.usd, props.rate ?? s.rate);
  if (props.inline)
    return (
      <span>
        <b>{fmtUSD(props.usd)}</b> <span class="cdf">{fmtCDF(cdf)}</span>
      </span>
    );
  return (
    <div>
      <div class={props.big ? 'big' : 'usd'}>{fmtUSD(props.usd)}</div>
      <div class="cdf">{fmtCDF(cdf)}</div>
    </div>
  );
}

export function PriceOf(props: { p: Product }) {
  const s = useSession();
  return <Money usd={props.p.priceUSD} cdf={productPriceCDF(props.p, s.rate)} />;
}

export function Qty(props: { n: number; min?: number }) {
  const cls = props.n < 0 ? 'qty neg' : props.min !== undefined && props.n <= props.min ? 'qty low' : 'qty';
  return <span class={cls}>{props.n}</span>;
}

// ---------- product picker (search + list), used by sale, transfers, purchases, counts ----------
export function matchProduct(p: Product, q: string): boolean {
  if (!q) return true;
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hay = norm(`${p.name} ${p.ref} ${p.brand ?? ''} ${p.barcode ?? ''} ${p.category} ${p.fits.map((f) => `${f.brand} ${f.model}`).join(' ')}`);
  return words.every((w) => hay.includes(w));
}
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_./]/g, ' ');

export function fitsText(p: Product): string {
  if (!p.fits.length) return t('product.universal');
  const models = p.fits.map((f) => `${f.brand} ${f.model}`);
  return models.length > 2 ? `${models.slice(0, 2).join(', ')} +${models.length - 2}` : models.join(', ');
}

export function useDebounced<T>(v: T, ms = 150): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}
