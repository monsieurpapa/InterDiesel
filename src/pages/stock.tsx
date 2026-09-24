import { useMemo, useState } from 'preact/hooks';
import { db, engine, go, t, toast, useLive, useSession, useStock } from '../state';
import { Empty, Field, Icon, Page, Qty, Seg, matchProduct, useDebounced } from '../ui';
import { lowStockText } from '../../shared/messages';
import { fmtUSD, round2 } from '../../shared/money';
import type { AdjustReason, Adjustment, MinStock, Product } from '../../shared/types';
import { sendWhatsApp } from '../share';
import { useReversedIds } from './admin';

export function StockPage() {
  const s = useSession();
  const stock = useStock(s.storeId);
  const mins = useLive(() => db.minstock.where('storeId').equals(s.storeId).toArray() as Promise<MinStock[]>, [s.storeId], [] as MinStock[]);
  const [tab, setTab] = useState<'low' | 'neg' | 'all'>('low');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const minBy = new Map(mins.map((m) => [m.productId, m.min]));
  const active = s.products.filter((p) => p.active);

  const rows = useMemo(() => {
    const r = active.map((p) => ({ p, qty: stock.get(p.id) ?? 0, min: minBy.get(p.id) ?? 0 }));
    const f =
      tab === 'low' ? r.filter((x) => x.qty <= x.min && x.min > 0 && x.qty >= 0) : tab === 'neg' ? r.filter((x) => x.qty < 0) : r.filter((x) => matchProduct(x.p, dq));
    return f.sort((a, b) => a.qty - a.min - (b.qty - b.min) || a.p.name.localeCompare(b.p.name));
  }, [tab, stock, mins, s.products, dq]);

  const value = useMemo(() => {
    let cost = 0;
    let retail = 0;
    for (const p of active) {
      const q = Math.max(0, stock.get(p.id) ?? 0);
      cost += q * p.costUSD;
      retail += q * p.priceUSD;
    }
    return { cost: round2(cost), retail: round2(retail) };
  }, [stock, s.products]);

  const shareLow = () => {
    const low = rows.filter((r) => r.qty <= r.min).map((r) => ({ p: r.p, qty: r.qty, min: r.min }));
    sendWhatsApp({ kind: 'low_stock', text: lowStockText(t, s.store.name, low) });
  };

  return (
    <Page title={t('stock.title')} back="/products">
      <table class="facts" style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <th>{t('stock.valueCost')}</th>
            <td class="n usd">{s.can('price.edit') ? fmtUSD(value.cost) : '—'}</td>
          </tr>
          <tr>
            <th>{t('stock.valueRetail')}</th>
            <td class="n usd">{fmtUSD(value.retail)}</td>
          </tr>
        </tbody>
      </table>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { value: 'low', label: t('stock.low') },
          { value: 'neg', label: t('stock.negative') },
          { value: 'all', label: t('stock.all') },
        ]}
      />
      {tab === 'all' && (
        <input style={{ marginTop: 8 }} type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('products.searchPh')} aria-label={t('products.search')} />
      )}
      {tab === 'low' && rows.length > 0 && (
        <div class="row" style={{ marginTop: 8 }}>
          <button class="btn wa" style={{ flex: '1 1 230px' }} onClick={shareLow}>
            <Icon.whatsapp />
            {t('stock.shareLow')}
          </button>
          {s.can('purchase') && <a class="btn" style={{ flex: '1 1 120px' }} href="#/purchase/new">{t('stock.order')}</a>}
        </div>
      )}
      {tab === 'neg' && rows.length > 0 && <div class="notice bad" style={{ marginTop: 8 }}>{t('stock.negativeExplain')}</div>}
      <div class="list" style={{ marginTop: 8 }}>
        {rows.slice(0, 300).map((r) => (
          <a class="item" href={`#/product/${r.p.id}`}>
            <div class="main">
              <div class="title">{r.p.name}</div>
              <div class="sub">{r.p.ref} · {t('stock.minShort', { n: r.min })}</div>
            </div>
            <div class="end">
              <Qty n={r.qty} min={r.min} />
            </div>
          </a>
        ))}
        {!rows.length && <Empty>{tab === 'low' ? t('stock.noLow') : tab === 'neg' ? t('stock.noNegative') : t('sell.noResult')}</Empty>}
      </div>
    </Page>
  );
}

const REASONS: AdjustReason[] = ['damaged', 'lost', 'found', 'returned_supplier', 'customer_return', 'correction', 'other'];

export function AdjustPage(props: { productId: string }) {
  const s = useSession();
  const stock = useStock(s.storeId);
  const [productId, setProductId] = useState(props.productId);
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<AdjustReason>('damaged');
  const [note, setNote] = useState('');
  const recent = useLive(
    () => db.adjustment.where('storeId').equals(s.storeId).reverse().sortBy('at').then((a: Adjustment[]) => a.slice(0, 15)),
    [s.storeId],
    [] as Adjustment[],
  );
  const p = s.productById.get(productId);
  const reversed = useReversedIds();
  if (!s.can('adjust')) return <Page title={t('adjust.title')} back><Empty>{t('error.forbidden')}</Empty></Page>;

  const submit = async (e: Event) => {
    e.preventDefault();
    const n = parseInt(qty) || 0;
    if (!p || n <= 0 || note.trim().length < 2) return;
    await engine.createDoc<Adjustment>('adjustment', s.user.id, s.storeId, { productId: p.id, qty: dir === 'out' ? -n : n, reason, note: note.trim() });
    toast(t('toast.adjusted', { name: p.name, qty: dir === 'out' ? `-${n}` : `+${n}` }), 'success');
    go(`/product/${p.id}`);
  };

  return (
    <Page title={t('adjust.title')} back>
      <form class="stack" onSubmit={submit}>
        {p ? (
          <div class="row">
            <div class="grow">
              <b>{p.name}</b>
              <div class="muted">{p.ref} · {t('sell.inStock')} {stock.get(p.id) ?? 0}</div>
            </div>
            <button type="button" class="btn small" onClick={() => setProductId('')}>{t('common.change')}</button>
          </div>
        ) : (
          <ProductPick q={q} setQ={setQ} products={s.products} onPick={(x) => setProductId(x.id)} />
        )}
        <Seg value={dir} onChange={setDir} options={[{ value: 'out', label: t('adjust.remove') }, { value: 'in', label: t('adjust.add') }]} />
        <Field label={t('adjust.qty')}>
          <input inputMode="numeric" value={qty} onInput={(e) => setQty(e.currentTarget.value)} required />
        </Field>
        <Field label={t('adjust.reason')}>
          <select value={reason} onChange={(e) => setReason(e.currentTarget.value as AdjustReason)}>
            {REASONS.map((r) => (
              <option value={r}>{t(`reason.${r}`)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('adjust.note')} hint={t('adjust.noteHint')}>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} required minLength={2} />
        </Field>
        <button class="btn primary block" disabled={!p || note.trim().length < 2 || !(parseInt(qty) > 0)}>{t('adjust.save')}</button>
      </form>
      <h2 style={{ marginTop: 20 }}>{t('adjust.recent')}</h2>
      <div class="list">
        {recent.map((a) => (
          <div class="item" style={{ cursor: 'default' }}>
            <div class="main">
              <div class="title">{s.productById.get(a.productId)?.name}</div>
              <div class="sub">{t(`reason.${a.reason}`)} · {a.note}</div>
            </div>
            <div class="end">
              <div class={`qty ${a.qty < 0 ? 'neg' : 'pos'}`}>{a.qty > 0 ? `+${a.qty}` : a.qty}</div>
              {reversed.has(a.id) ? <span class="tag">{t('reverse.tag')}</span> : s.can('doc.reverse') && <a class="btn small danger" href={`#/reverse/adjustment/${a.id}`}>{t('reverse.short')}</a>}
            </div>
          </div>
        ))}
        {!recent.length && <Empty>{t('adjust.none')}</Empty>}
      </div>
    </Page>
  );
}

/** Inline product search used in forms (no popup). */
export function ProductPick(props: { q: string; setQ: (v: string) => void; products: Product[]; onPick: (p: Product) => void; exclude?: Set<string> }) {
  const dq = useDebounced(props.q);
  const list = dq.trim() ? props.products.filter((p) => p.active && !props.exclude?.has(p.id) && matchProduct(p, dq)).slice(0, 8) : [];
  return (
    <div>
      <input type="search" value={props.q} onInput={(e) => props.setQ(e.currentTarget.value)} placeholder={t('pick.ph')} aria-label={t('pick.ph')} />
      {list.length > 0 && (
        <div class="list" style={{ marginTop: 4 }}>
          {list.map((p) => (
            <button type="button" class="item" onClick={() => { props.onPick(p); props.setQ(''); }}>
              <div class="main">
                <div class="title">{p.name}</div>
                <div class="sub">{p.ref}</div>
              </div>
              <Icon.plus width={24} height={24} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
