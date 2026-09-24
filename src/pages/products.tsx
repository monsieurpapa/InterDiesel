import { useMemo, useState } from 'preact/hooks';
import { ulid } from 'ulid';
import { db, engine, go, notifySave, t, toast, useLive, useSession, useStock } from '../state';
import { Empty, Field, Icon, Money, Page, Qty, Section, fitsText, matchProduct, useDebounced } from '../ui';
import { Scanner } from '../scanner';
import { fmtUSD, productPriceCDF, round2, usdToCdf, fmtCDF } from '../../shared/money';
import { fmtDate, fmtDateTime } from '../../shared/time';
import { stockId } from '../../shared/derive';
import type { Fitment, MinStock, Movement, Product, Purchase } from '../../shared/types';

export const CATEGORIES = ['Moteur', 'Freinage', 'Transmission', 'Électricité', 'Filtres', 'Pneus et chambres', 'Lubrifiants', 'Suspension', 'Carrosserie et accessoires'];

export function ProductsPage() {
  const s = useSession();
  const stock = useStock(s.storeId);
  const all = useStock(null);
  const mins = useLive(() => db.minstock.where('storeId').equals(s.storeId).toArray() as Promise<MinStock[]>, [s.storeId], [] as MinStock[]);
  const minBy = new Map(mins.map((m) => [m.productId, m.min]));
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [cat, setCat] = useState('');
  const [scan, setScan] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const cats = [...new Set([...CATEGORIES, ...s.products.map((p) => p.category)])].filter((c) => s.products.some((p) => p.category === c));
  const list = useMemo(
    () =>
      s.products
        .filter((p) => (showInactive ? !p.active : p.active) && (!cat || p.category === cat) && matchProduct(p, dq))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 200),
    [s.products, dq, cat, showInactive],
  );
  const others = (pid: string) => s.stores.filter((st) => st.id !== s.storeId).reduce((a, st) => a + Math.max(0, all.get(`${st.id}:${pid}`) ?? 0), 0);

  return (
    <Page
      title={t('products.title')}
      actions={
        s.can('product.edit') && (
          <a class="btn small dark" href="#/product/new">
            <Icon.plus />
            {t('common.new')}
          </a>
        )
      }
    >
      <div class="row">
        <input class="grow" style={{ flex: 1 }} type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('products.searchPh')} aria-label={t('products.search')} />
        <button class="btn dark" onClick={() => setScan(!scan)}>
          <Icon.scan />
          {t('sell.scan')}
        </button>
      </div>
      {scan && (
        <Scanner
          onClose={() => setScan(false)}
          onCode={(code) => {
            setScan(false);
            const p = s.products.find((x) => x.barcode === code || x.ref === code);
            if (p) go(`/product/${p.id}`);
            else setQ(code);
          }}
        />
      )}
      <div class="chips" style={{ marginTop: 8 }}>
        <button class={!cat ? 'on' : ''} onClick={() => setCat('')}>{t('products.allCats')}</button>
        {cats.map((c) => (
          <button class={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div class="row" style={{ margin: '4px 0 8px' }}>
        <a class="btn small" href="#/stock">{t('products.toStock')}</a>
        {s.can('product.edit') && (
          <label class="check" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
            {t('products.showInactive')}
          </label>
        )}
      </div>
      <div class="list">
        {list.map((p) => {
          const qty = stock.get(p.id) ?? 0;
          const o = others(p.id);
          return (
            <a class="item" href={`#/product/${p.id}`}>
              <div class="main">
                <div class="title">{p.name}</div>
                <div class="sub">{p.ref} · {p.brand}</div>
                <div class="sub">{fitsText(p)}</div>
                <div class="sub">
                  {t('products.here')} <Qty n={qty} min={minBy.get(p.id)} /> · {t('products.others')} {o}
                </div>
              </div>
              <div class="end">
                <Money usd={p.priceUSD} cdf={productPriceCDF(p, s.rate)} />
              </div>
            </a>
          );
        })}
        {!list.length && <Empty>{t('sell.noResult')}</Empty>}
      </div>
    </Page>
  );
}

export function ProductPage(props: { id: string }) {
  const s = useSession();
  const p = s.productById.get(props.id);
  const all = useStock(null);
  const photo = useLive(() => db.photo.get(props.id), [props.id], undefined as any);
  const min = useLive(() => db.minstock.get(stockId(s.storeId, props.id)) as Promise<MinStock | undefined>, [s.storeId, props.id], undefined);
  const moves = useLive(
    () => db.movement.where('[storeId+productId]').equals([s.storeId, props.id]).toArray().then((m: Movement[]) => m.sort((a, b) => b.at - a.at).slice(0, 30)),
    [s.storeId, props.id],
    [] as Movement[],
  );
  const purchases = useLive(
    async () => {
      const ps = (await db.purchase.toArray()) as Purchase[];
      return ps
        .flatMap((x) => x.lines.filter((l) => l.productId === props.id).map((l) => ({ at: x.at, cost: l.unitCostUSD, qty: l.qty, storeId: x.storeId })))
        .sort((a, b) => b.at - a.at)
        .slice(0, 10);
    },
    [props.id],
    [] as { at: number; cost: number; qty: number; storeId: string }[],
  );
  const [minInput, setMinInput] = useState<string | null>(null);
  if (!p) return <Page title={t('products.title')} back="/products"><Empty>{t('common.notFound')}</Empty></Page>;
  const here = all.get(`${s.storeId}:${p.id}`) ?? 0;
  const users = new Map(s.users.map((u) => [u.id, u.name]));
  const margin = p.priceUSD > 0 ? Math.round(((p.priceUSD - p.costUSD) / p.priceUSD) * 100) : 0;

  const saveMin = async () => {
    const n = Math.max(0, parseInt(minInput ?? '') || 0);
    await engine.patch('minstock', stockId(s.storeId, p.id), s.user.id, { storeId: s.storeId, productId: p.id, min: n });
    setMinInput(null);
    toast(t('toast.minSaved', { name: p.name, n }), 'info');
  };

  return (
    <Page
      title={p.name}
      back="/products"
      actions={
        s.can('product.edit') && (
          <a class="btn small" href={`#/product/${p.id}/edit`}>{t('common.edit')}</a>
        )
      }
    >
      <div class="row" style={{ alignItems: 'flex-start' }}>
        {photo?.dataUrl && <img src={photo.dataUrl} alt="" style={{ width: 112, height: 112, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />}
        <div class="grow">
          <div class="muted">{p.ref} · {p.brand} · {p.category}</div>
          {p.barcode && <div class="muted">{t('product.barcode')}: {p.barcode}</div>}
          <div style={{ marginTop: 6 }}>
            <Money usd={p.priceUSD} cdf={productPriceCDF(p, s.rate)} big />
          </div>
          {s.can('price.edit') && (
            <div class="muted">
              {t('product.cost')} {fmtUSD(p.costUSD)} · {t('product.margin')} {margin}%
            </div>
          )}
        </div>
      </div>

      <Section title={t('product.stockByStore')} />
      <table class="facts">
        <tbody>
          {s.stores.map((st) => {
            const q = all.get(`${st.id}:${p.id}`) ?? 0;
            return (
              <tr>
                <td>{st.name}{st.id === s.storeId && <b> ({t('product.thisStore')})</b>}</td>
                <td class="n"><Qty n={q} min={st.id === s.storeId ? min?.min : undefined} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {here < 0 && <div class="notice bad" style={{ marginTop: 8 }}>{t('stock.negativeExplain')}</div>}
      <div class="row" style={{ marginTop: 10 }}>
        {s.can('adjust') && <a class="btn small" href={`#/adjust?product=${p.id}`}>{t('product.adjust')}</a>}
        <a class="btn small" href={`#/transfer/request?product=${p.id}`}>{t('product.requestTransfer')}</a>
        <a class="btn small primary" href="#/" onClick={() => {
          try {
            const c = JSON.parse(localStorage.getItem('cart') ?? 'null') ?? { lines: [], customerId: null, discountUSD: 0, note: '' };
            const l = c.lines.find((x: any) => x.productId === p.id);
            if (l) l.qty++;
            else c.lines.push({ productId: p.id, qty: 1, unitUSD: p.priceUSD });
            localStorage.setItem('cart', JSON.stringify(c));
          } catch {}
        }}>{t('product.sell')}</a>
      </div>

      <Section title={t('product.minStock')} />
      {minInput === null ? (
        <div class="row">
          <div class="grow">{t('product.minIs', { n: min?.min ?? 0 })}</div>
          {s.can('minstock.edit') && <button class="btn small" onClick={() => setMinInput(String(min?.min ?? 0))}>{t('common.edit')}</button>}
        </div>
      ) : (
        <div class="row">
          <input class="grow" style={{ flex: 1 }} inputMode="numeric" value={minInput} onInput={(e) => setMinInput(e.currentTarget.value)} aria-label={t('product.minStock')} />
          <button class="btn primary small" onClick={saveMin}>{t('common.save')}</button>
        </div>
      )}

      <Section title={t('product.fits')} />
      {p.fits.length ? (
        <ul>
          {p.fits.map((f) => (
            <li>{f.brand} {f.model} {f.years && <span class="muted">({f.years})</span>}</li>
          ))}
        </ul>
      ) : (
        <p class="muted">{t('product.universal')}</p>
      )}

      <Section title={t('product.moves')} />
      <div class="list">
        {moves.map((m) => (
          <div class="item" style={{ cursor: 'default', minHeight: 52 }}>
            <div class="main">
              <div>{t(`move.${m.kind}`)}{(m as any).pending ? <span class="tag warn" style={{ marginLeft: 6 }}>{t('sync.notSent')}</span> : null}</div>
              <div class="sub">{fmtDateTime(m.at)} · {users.get(m.userId)}</div>
            </div>
            <div class={`end qty ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</div>
          </div>
        ))}
        {!moves.length && <Empty>{t('product.noMoves')}</Empty>}
      </div>

      {s.can('price.edit') && (
        <>
          <Section title={t('product.costHistory')} />
          <table class="facts">
            <tbody>
              {purchases.map((x) => (
                <tr>
                  <td>{fmtDate(x.at)} · {s.stores.find((st) => st.id === x.storeId)?.name}</td>
                  <td class="n">{x.qty} × {fmtUSD(x.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!purchases.length && <Empty>{t('product.noPurchases')}</Empty>}
        </>
      )}
    </Page>
  );
}

async function resizePhoto(file: File): Promise<string> {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const max = 360;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', 0.7);
}

export function ProductEditPage(props: { id?: string }) {
  const s = useSession();
  const existing = props.id ? s.productById.get(props.id) : undefined;
  const [f, setF] = useState<Omit<Product, 'id'>>(
    existing ?? { ref: '', barcode: '', name: '', brand: '', category: CATEGORIES[0], fits: [], costUSD: 0, priceUSD: 0, priceCDF: null, unit: 'pièce', active: true },
  );
  const [cdfFixed, setCdfFixed] = useState(!!existing?.priceCDF);
  const [photo, setPhoto] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Product>) => setF({ ...f, ...patch });
  const num = (v: string) => Math.max(0, round2(Number(v.replace(',', '.')) || 0));
  const setFit = (i: number, patch: Partial<Fitment>) => set({ fits: f.fits.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const save = async (e: Event) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    const id = props.id ?? `p_${ulid()}`;
    const fields: Record<string, unknown> = {
      ...f,
      name: f.name.trim(),
      ref: f.ref.trim(),
      fits: f.fits.filter((x) => x.brand.trim() || x.model.trim()),
      priceCDF: cdfFixed ? f.priceCDF : null,
    };
    if (!s.can('price.edit')) {
      delete fields.priceUSD;
      delete fields.priceCDF;
      delete fields.costUSD;
    }
    // send only what changed, so edits made elsewhere on other fields are kept
    const changed = existing ? Object.fromEntries(Object.entries(fields).filter(([k, v]) => JSON.stringify((existing as any)[k]) !== JSON.stringify(v))) : fields;
    if (Object.keys(changed).length) await engine.patch('product', id, s.user.id, changed);
    if (photo) await engine.patch('photo', id, s.user.id, { dataUrl: photo });
    notifySave(fields.name as string, existing, photo ? { ...changed, photo: 1 } : changed);
    go(`/product/${id}`);
  };
  const dup = f.ref.trim() ? s.products.find((p) => p.id !== props.id && p.ref.trim().toLowerCase() === f.ref.trim().toLowerCase()) : undefined;

  return (
    <Page title={existing ? t('product.edit') : t('product.new')} back>
      <form class="stack" onSubmit={save}>
        <Field label={t('product.name')}>
          <input value={f.name} onInput={(e) => set({ name: e.currentTarget.value })} required />
        </Field>
        <div class="grid2">
          <Field label={t('product.ref')}>
            <input value={f.ref} onInput={(e) => set({ ref: e.currentTarget.value })} />
          </Field>
          <Field label={t('product.brand')}>
            <input value={f.brand} onInput={(e) => set({ brand: e.currentTarget.value })} />
          </Field>
        </div>
        {dup && <div class="notice warn">{t('product.dupRef', { name: dup.name })}</div>}
        <Field label={t('product.barcode')}>
          <div class="row">
            <input class="grow" style={{ flex: 1 }} value={f.barcode} onInput={(e) => set({ barcode: e.currentTarget.value })} />
            <button type="button" class="btn" onClick={() => setScan(!scan)}><Icon.scan />{t('sell.scan')}</button>
          </div>
        </Field>
        {scan && <Scanner onClose={() => setScan(false)} onCode={(c) => { set({ barcode: c }); setScan(false); }} />}
        <div class="grid2">
          <Field label={t('product.category')}>
            <select value={f.category} onChange={(e) => set({ category: e.currentTarget.value })}>
              {[...new Set([...CATEGORIES, f.category])].map((c) => (
                <option>{c}</option>
              ))}
            </select>
          </Field>
          <Field label={t('product.unit')}>
            <input value={f.unit} onInput={(e) => set({ unit: e.currentTarget.value })} />
          </Field>
        </div>
        {s.can('price.edit') && (
          <>
            <div class="grid2">
              <Field label={t('product.costUSD')}>
                <input inputMode="decimal" value={f.costUSD} onChange={(e) => set({ costUSD: num(e.currentTarget.value) })} />
              </Field>
              <Field label={t('product.priceUSD')}>
                <input inputMode="decimal" value={f.priceUSD} onChange={(e) => set({ priceUSD: num(e.currentTarget.value) })} />
              </Field>
            </div>
            <label class="check">
              <input type="checkbox" checked={cdfFixed} onChange={(e) => { setCdfFixed(e.currentTarget.checked); if (e.currentTarget.checked && !f.priceCDF) set({ priceCDF: usdToCdf(f.priceUSD, s.rate) }); }} />
              {t('product.fixedCdf')}
            </label>
            {cdfFixed ? (
              <Field label={t('product.priceCDF')}>
                <input inputMode="numeric" value={f.priceCDF ?? ''} onChange={(e) => set({ priceCDF: Math.round(num(e.currentTarget.value)) })} />
              </Field>
            ) : (
              <p class="muted">{t('product.cdfAuto', { cdf: fmtCDF(usdToCdf(f.priceUSD, s.rate)), rate: s.rate })}</p>
            )}
          </>
        )}
        <Section title={t('product.fits')} />
        {f.fits.map((x, i) => (
          <div class="grid3">
            <input value={x.brand} onInput={(e) => setFit(i, { brand: e.currentTarget.value })} placeholder={t('product.fitBrand')} aria-label={t('product.fitBrand')} />
            <input value={x.model} onInput={(e) => setFit(i, { model: e.currentTarget.value })} placeholder={t('product.fitModel')} aria-label={t('product.fitModel')} />
            <div class="row" style={{ flexWrap: 'nowrap' }}>
              <input value={x.years ?? ''} onInput={(e) => setFit(i, { years: e.currentTarget.value })} placeholder={t('product.fitYears')} aria-label={t('product.fitYears')} />
              <button type="button" class="btn small danger" onClick={() => set({ fits: f.fits.filter((_, j) => j !== i) })} aria-label={t('common.remove')}>
                <Icon.x />
              </button>
            </div>
          </div>
        ))}
        <button type="button" class="btn" onClick={() => set({ fits: [...f.fits, { brand: '', model: '', years: '' }] })}>
          <Icon.plus />
          {t('product.addFit')}
        </button>
        <Field label={t('product.photo')} hint={t('product.photoHint')}>
          <input type="file" accept="image/*" capture="environment" onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            if (file) setPhoto(await resizePhoto(file));
          }} />
        </Field>
        {photo && <img src={photo} alt="" style={{ width: 120, borderRadius: 6 }} />}
        {existing && (
          <label class="check">
            <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.currentTarget.checked })} />
            {t('product.active')}
          </label>
        )}
        <button class="btn primary block" disabled={busy}>{t('common.save')}</button>
      </form>
    </Page>
  );
}
