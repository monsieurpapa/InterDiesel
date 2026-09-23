// Physical inventory: count what is on the shelf, see the gap against the system,
// then save. Only lines actually counted are included; saving adjusts stock by the gap.
import { useMemo, useState } from 'preact/hooks';
import { db, engine, go, t, toast, useLive, useSession, useStock } from '../state';
import { Empty, Field, Icon, Page, matchProduct, useDebounced } from '../ui';
import { CATEGORIES } from './products';
import { fmtUSD, round2 } from '../../shared/money';
import { fmtDateTime } from '../../shared/time';
import type { Count } from '../../shared/types';

export function CountsPage() {
  const s = useSession();
  const list = useLive(() => db.count.where('storeId').equals(s.storeId).toArray().then((x: Count[]) => x.sort((a, b) => b.at - a.at)), [s.storeId], [] as Count[]);
  return (
    <Page title={t('counts.title')} back="/menu" actions={s.can('count') && <a class="btn small dark" href="#/count/new"><Icon.plus />{t('counts.start')}</a>}>
      <p class="muted">{t('counts.explain')}</p>
      <div class="list">
        {list.map((c) => {
          const gaps = c.lines.filter((l) => l.counted !== l.expected).length;
          return (
            <a class="item" href={`#/count/${c.id}`}>
              <div class="main">
                <div class="title">{fmtDateTime(c.at)}</div>
                <div class="sub">{t('counts.summary', { n: c.lines.length, gaps })} · {s.users.find((u) => u.id === c.userId)?.name}</div>
              </div>
              {gaps ? <span class="tag bad">{t('counts.gaps', { n: gaps })}</span> : <span class="tag ok">{t('counts.ok')}</span>}
            </a>
          );
        })}
        {!list.length && <Empty>{t('counts.none')}</Empty>}
      </div>
    </Page>
  );
}

const DRAFT = 'countDraft';

export function CountNewPage() {
  const s = useSession();
  const stock = useStock(s.storeId);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [counted, setCountedState] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${DRAFT}:${s.storeId}`) ?? '{}');
    } catch {
      return {};
    }
  });
  const [note, setNote] = useState('');
  const [review, setReview] = useState(false);
  const setCounted = (c: Record<string, string>) => {
    setCountedState(c);
    try {
      localStorage.setItem(`${DRAFT}:${s.storeId}`, JSON.stringify(c));
    } catch {}
  };
  const products = useMemo(
    () => s.products.filter((p) => p.active && (!cat || p.category === cat) && matchProduct(p, dq)).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [s.products, cat, dq],
  );
  const entered = Object.entries(counted).filter(([, v]) => v.trim() !== '');
  const lines = entered.map(([pid, v]) => ({ productId: pid, expected: stock.get(pid) ?? 0, counted: Math.max(0, parseInt(v) || 0) }));
  const gaps = lines.filter((l) => l.counted !== l.expected);
  const gapValue = round2(gaps.reduce((a, l) => a + (l.counted - l.expected) * (s.productById.get(l.productId)?.costUSD ?? 0), 0));
  if (!s.can('count')) return <Page title={t('counts.title')} back><Empty>{t('error.forbidden')}</Empty></Page>;

  const save = async () => {
    if (!lines.length) return;
    const doc = await engine.createDoc<Count>('count', s.user.id, s.storeId, { lines, note: note || undefined });
    setCounted({});
    toast(t('counts.saved'));
    go(`/count/${doc.id}`);
  };

  if (review)
    return (
      <Page title={t('counts.review')} back={false}>
        <div class="headline">
          <div class="label">{t('counts.summary', { n: lines.length, gaps: gaps.length })}</div>
          <div class={`usd ${gapValue < 0 ? 'neg' : ''}`}>{t('counts.gapValue', { v: fmtUSD(gapValue) })}</div>
        </div>
        <table class="facts">
          <thead><tr><th>{t('reports.product')}</th><th class="n">{t('counts.system')}</th><th class="n">{t('counts.counted')}</th><th class="n">{t('counts.gap')}</th></tr></thead>
          <tbody>
            {gaps.map((l) => (
              <tr>
                <td>{s.productById.get(l.productId)?.name}</td>
                <td class="n">{l.expected}</td>
                <td class="n">{l.counted}</td>
                <td class="n"><span class={`qty ${l.counted < l.expected ? 'neg' : 'pos'}`}>{l.counted - l.expected > 0 ? '+' : ''}{l.counted - l.expected}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!gaps.length && <div class="notice ok">{t('counts.allMatch')}</div>}
        <Field label={t('cart.note')}>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </Field>
        <div class="row" style={{ marginTop: 12 }}>
          <button class="btn" onClick={() => setReview(false)}>{t('counts.continue')}</button>
          <button class="btn primary grow" onClick={save}>{t('counts.apply')}</button>
        </div>
      </Page>
    );

  return (
    <Page title={t('counts.new')} back>
      <p class="muted">{t('counts.how')}</p>
      <select value={cat} onChange={(e) => setCat(e.currentTarget.value)} aria-label={t('product.category')}>
        <option value="">{t('products.allCats')}</option>
        {CATEGORIES.map((c) => (
          <option>{c}</option>
        ))}
      </select>
      <input style={{ marginTop: 8 }} type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('products.searchPh')} aria-label={t('products.search')} />
      <div class="list" style={{ marginTop: 8, paddingBottom: 90 }}>
        {products.map((p) => {
          const v = counted[p.id] ?? '';
          const exp = stock.get(p.id) ?? 0;
          const n = parseInt(v);
          const diff = v.trim() === '' || isNaN(n) ? null : n - exp;
          return (
            <div class="item" style={{ cursor: 'default' }}>
              <div class="main">
                <div class="title">{p.name}</div>
                <div class="sub">{p.ref} · {t('counts.systemSays', { n: exp })}</div>
                {diff !== null && diff !== 0 && <div class={diff < 0 ? 'neg' : 'pos'}><b>{t('counts.gapShort', { n: diff > 0 ? `+${diff}` : diff })}</b></div>}
              </div>
              <input style={{ width: 88 }} inputMode="numeric" value={v} onInput={(e) => setCounted({ ...counted, [p.id]: e.currentTarget.value })} placeholder="—" aria-label={t('counts.counted')} />
            </div>
          );
        })}
      </div>
      <div class="cartbar">
        <div class="grow">
          <b>{t('counts.progress', { n: lines.length })}</b>
          <div class="muted">{t('counts.gaps', { n: gaps.length })}</div>
        </div>
        <button class="btn primary" disabled={!lines.length} onClick={() => setReview(true)}>{t('counts.reviewBtn')}</button>
      </div>
    </Page>
  );
}

export function CountPage(props: { id: string }) {
  const s = useSession();
  const c = useLive(() => db.count.get(props.id) as Promise<Count | undefined>, [props.id], undefined);
  if (!c) return <Page title={t('counts.title')} back="/counts"><Empty>{t('common.notFound')}</Empty></Page>;
  const gaps = c.lines.filter((l) => l.counted !== l.expected);
  return (
    <Page title={t('counts.detail')} back="/counts">
      <p class="muted">{fmtDateTime(c.at)} · {s.users.find((u) => u.id === c.userId)?.name}</p>
      <p>{t('counts.summary', { n: c.lines.length, gaps: gaps.length })}</p>
      <table class="facts">
        <thead><tr><th>{t('reports.product')}</th><th class="n">{t('counts.system')}</th><th class="n">{t('counts.counted')}</th><th class="n">{t('counts.gap')}</th></tr></thead>
        <tbody>
          {[...gaps, ...c.lines.filter((l) => l.counted === l.expected)].map((l) => (
            <tr>
              <td>{s.productById.get(l.productId)?.name}</td>
              <td class="n">{l.expected}</td>
              <td class="n">{l.counted}</td>
              <td class={`n ${l.counted < l.expected ? 'neg' : l.counted > l.expected ? 'pos' : ''}`}>{l.counted - l.expected}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.note && <p>{c.note}</p>}
    </Page>
  );
}
