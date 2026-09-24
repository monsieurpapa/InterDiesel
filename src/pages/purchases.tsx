import { useState } from 'preact/hooks';
import { ulid } from 'ulid';
import { db, engine, go, notifySave, t, toast, useLive, useSession } from '../state';
import { Empty, Field, Icon, Page, Section } from '../ui';
import { ProductPick } from './stock';
import { ReverseControl, useReversedIds } from './admin';
import { fmtUSD, round2 } from '../../shared/money';
import { fmtDate, fmtDateTime } from '../../shared/time';
import type { Purchase, Supplier } from '../../shared/types';

function useSuppliers() {
  return useLive(() => db.supplier.toArray() as Promise<Supplier[]>, [], [] as Supplier[]);
}

export function PurchasesPage() {
  const s = useSession();
  const suppliers = useSuppliers();
  const list = useLive(
    () => db.purchase.where('storeId').equals(s.storeId).toArray().then((x: Purchase[]) => x.sort((a, b) => b.at - a.at).slice(0, 100)),
    [s.storeId],
    [] as Purchase[],
  );
  const sup = new Map(suppliers.map((x) => [x.id, x.name]));
  const reversed = useReversedIds();
  return (
    <Page
      title={t('purchases.title')}
      back="/menu"
      actions={s.can('purchase') && <a class="btn small dark" href="#/purchase/new"><Icon.plus />{t('common.new')}</a>}
    >
      <div class="list">
        {list.map((p) => (
          <a class="item" href={`#/purchase/${p.id}`}>
            <div class="main">
              <div class="title">{p.supplierId ? sup.get(p.supplierId) : t('purchases.noSupplier')} {reversed.has(p.id) && <span class="tag bad">{t('reverse.tag')}</span>}</div>
              <div class="sub">{fmtDate(p.at)} · {p.invoiceNo ?? ''} · {t('purchases.lines', { n: p.lines.length })}</div>
            </div>
            <div class="end usd">{fmtUSD(p.totalUSD)}</div>
          </a>
        ))}
        {!list.length && <Empty>{t('purchases.none')}</Empty>}
      </div>
      <p><a href="#/suppliers">{t('menu.suppliers')}</a></p>
    </Page>
  );
}

interface PLine {
  productId: string;
  qty: string;
  cost: string;
}

export function PurchaseNewPage() {
  const s = useSession();
  const suppliers = useSuppliers().filter((x) => x.active);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<PLine[]>([]);
  const [q, setQ] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const total = round2(lines.reduce((a, l) => a + num(l.qty) * num(l.cost), 0));
  const set = (i: number, patch: Partial<PLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  if (!s.can('purchase')) return <Page title={t('purchases.new')} back><Empty>{t('error.forbidden')}</Empty></Page>;

  const submit = async (e: Event) => {
    e.preventDefault();
    const ls = lines.map((l) => ({ productId: l.productId, qty: Math.round(num(l.qty)), unitCostUSD: round2(num(l.cost)) })).filter((l) => l.qty > 0);
    if (!ls.length) return;
    setBusy(true);
    const doc = await engine.createDoc<Purchase>('purchase', s.user.id, s.storeId, {
      supplierId: supplierId || null,
      invoiceNo: invoiceNo || undefined,
      lines: ls,
      totalUSD: round2(ls.reduce((a, l) => a + l.qty * l.unitCostUSD, 0)),
      note: note || undefined,
    });
    if (updateCost && s.can('price.edit')) {
      for (const l of ls) {
        const p = s.productById.get(l.productId);
        if (p && l.unitCostUSD > 0 && p.costUSD !== l.unitCostUSD) await engine.patch('product', p.id, s.user.id, { costUSD: l.unitCostUSD });
      }
    }
    toast(t('purchases.saved'), 'success');
    go(`/purchase/${doc.id}`);
  };

  return (
    <Page title={t('purchases.new')} back>
      <form class="stack" onSubmit={submit}>
        <Field label={t('purchases.supplier')}>
          <select value={supplierId} onChange={(e) => setSupplierId(e.currentTarget.value)}>
            <option value="">{t('purchases.noSupplier')}</option>
            {suppliers.map((x) => (
              <option value={x.id}>{x.name}{x.city ? ` (${x.city})` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label={t('purchases.invoice')}>
          <input value={invoiceNo} onInput={(e) => setInvoiceNo(e.currentTarget.value)} />
        </Field>
        <Section title={t('purchases.items')} />
        <div class="list">
          {lines.map((l, i) => {
            const p = s.productById.get(l.productId);
            return (
              <div class="item" style={{ flexWrap: 'wrap', cursor: 'default' }}>
                <div class="main" style={{ minWidth: '70%' }}>
                  <div class="title">{p?.name}</div>
                  <div class="sub">{p?.ref} · {t('purchases.lastCost', { cost: fmtUSD(p?.costUSD ?? 0) })}</div>
                </div>
                <button type="button" class="btn small danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={t('common.remove')}><Icon.x /></button>
                <div class="grid2" style={{ width: '100%' }}>
                  <Field label={t('purchases.qty')}>
                    <input inputMode="numeric" value={l.qty} onInput={(e) => set(i, { qty: e.currentTarget.value })} />
                  </Field>
                  <Field label={t('purchases.unitCost')}>
                    <input inputMode="decimal" value={l.cost} onInput={(e) => set(i, { cost: e.currentTarget.value })} />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
        <ProductPick q={q} setQ={setQ} products={s.products} exclude={new Set(lines.map((l) => l.productId))} onPick={(p) => setLines([...lines, { productId: p.id, qty: '1', cost: String(p.costUSD) }])} />
        {s.can('price.edit') && (
          <label class="check">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.currentTarget.checked)} />
            {t('purchases.updateCost')}
          </label>
        )}
        <Field label={t('cart.note')}>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </Field>
        <div class="headline">
          <div class="label">{t('reports.total')}</div>
          <div class="usd">{fmtUSD(total)}</div>
        </div>
        <button class="btn primary block" disabled={busy || !lines.length}>{t('purchases.save')}</button>
      </form>
    </Page>
  );
}

export function PurchasePage(props: { id: string }) {
  const s = useSession();
  const p = useLive(() => db.purchase.get(props.id) as Promise<Purchase | undefined>, [props.id], undefined);
  const suppliers = useSuppliers();
  if (!p) return <Page title={t('purchases.title')} back="/purchases"><Empty>{t('common.notFound')}</Empty></Page>;
  return (
    <Page title={t('purchases.detail')} back="/purchases">
      <p><b>{suppliers.find((x) => x.id === p.supplierId)?.name ?? t('purchases.noSupplier')}</b> · {p.invoiceNo}</p>
      <p class="muted">{fmtDateTime(p.at)} · {s.users.find((u) => u.id === p.userId)?.name}</p>
      <table class="facts">
        <tbody>
          {p.lines.map((l) => (
            <tr>
              <td>{s.productById.get(l.productId)?.name}<div class="muted">{s.productById.get(l.productId)?.ref}</div></td>
              <td class="n">{l.qty} × {fmtUSD(l.unitCostUSD)}</td>
            </tr>
          ))}
          <tr class="total"><td>{t('reports.total')}</td><td class="n">{fmtUSD(p.totalUSD)}</td></tr>
        </tbody>
      </table>
      {p.note && <p>{p.note}</p>}
      <ReverseControl kind="purchase" id={p.id} block />
    </Page>
  );
}

export function SuppliersPage() {
  const s = useSession();
  const list = useSuppliers();
  return (
    <Page title={t('menu.suppliers')} back="/menu" actions={s.can('supplier.edit') && <a class="btn small dark" href="#/supplier/new"><Icon.plus />{t('common.new')}</a>}>
      <div class="list">
        {list.sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
          <a class="item" href={`#/supplier/${x.id}`}>
            <div class="main">
              <div class="title">{x.name}{!x.active && <span class="tag" style={{ marginLeft: 6 }}>{t('common.inactive')}</span>}</div>
              <div class="sub">{x.city} · {x.phone}</div>
            </div>
          </a>
        ))}
        {!list.length && <Empty>{t('suppliers.none')}</Empty>}
      </div>
    </Page>
  );
}

export function SupplierEditPage(props: { id?: string }) {
  const s = useSession();
  const list = useSuppliers();
  const existing = props.id ? list.find((x) => x.id === props.id) : undefined;
  const [f, setF] = useState<Partial<Supplier> | null>(null);
  const v: Omit<Supplier, 'id'> = { name: '', phone: '', city: '', note: '', active: true, ...(existing ?? {}), ...(f ?? {}) };
  const set = (p: Partial<Supplier>) => setF({ ...(f ?? {}), ...p });
  const save = async (e: Event) => {
    e.preventDefault();
    if (!v.name.trim()) return;
    const id = props.id ?? `f_${ulid()}`;
    const fields = existing ? (f ?? {}) : v;
    if (Object.keys(fields).length) await engine.patch('supplier', id, s.user.id, fields as Record<string, unknown>);
    notifySave(v.name, existing, fields);
    go('/suppliers');
  };
  if (props.id && !existing) return null;
  return (
    <Page title={existing ? t('suppliers.edit') : t('suppliers.new')} back>
      <form class="stack" onSubmit={save}>
        <Field label={t('customer.name')}><input value={v.name} onInput={(e) => set({ name: e.currentTarget.value })} required /></Field>
        <Field label={t('customer.phone')}><input value={v.phone} onInput={(e) => set({ phone: e.currentTarget.value })} inputMode="tel" /></Field>
        <Field label={t('suppliers.city')}><input value={v.city} onInput={(e) => set({ city: e.currentTarget.value })} /></Field>
        <Field label={t('customer.note')}><textarea value={v.note} onInput={(e) => set({ note: e.currentTarget.value })} /></Field>
        {existing && (
          <label class="check"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.currentTarget.checked })} />{t('common.active')}</label>
        )}
        <button class="btn primary block" disabled={!s.can('supplier.edit')}>{t('common.save')}</button>
      </form>
    </Page>
  );
}
