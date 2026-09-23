import { useMemo, useState } from 'preact/hooks';
import { db, engine, t, useLive, useRoute, useSession, useStock } from '../state';
import { Empty, Icon, Page, Section, Seg } from '../ui';
import { activeSales, customerBalances, daySummary, productStats, saleCost, collected } from '../../shared/reports';
import { dailySummaryText } from '../../shared/messages';
import { fmtCDF, fmtUSD, round2, usdToCdf } from '../../shared/money';
import { dayKey, dayStart, DAY_MS, fmtDate } from '../../shared/time';
import type { LedgerEntry, Repayment, Sale, SaleVoid } from '../../shared/types';
import { sendWhatsApp } from '../share';

type Period = 'today' | 'yesterday' | '7d' | '30d';
type Tab = 'sales' | 'products' | 'debts' | 'stock';

export function ReportsPage() {
  const s = useSession();
  return s.can('report.view') ? <ManagerReports /> : <SellerDay />;
}

function ManagerReports() {
  const s = useSession();
  const { query } = useRoute();
  const [tab, setTab] = useState<Tab>((query.get('tab') as Tab) || 'sales');
  const [period, setPeriod] = useState<Period>('today');
  const canAll = s.can('report.allStores');
  const [scope, setScope] = useState<string>(s.storeId); // '*' = all stores
  const storeId = canAll ? (scope === '*' ? null : scope) : s.storeId;

  const today = dayKey(engine.now());
  const [from, to] = useMemo(() => {
    const start = dayStart(today);
    switch (period) {
      case 'today':
        return [start, start + DAY_MS];
      case 'yesterday':
        return [start - DAY_MS, start];
      case '7d':
        return [start - 6 * DAY_MS, start + DAY_MS];
      case '30d':
        return [start - 29 * DAY_MS, start + DAY_MS];
    }
  }, [period, today]);

  return (
    <Page title={t('reports.title')}>
      {canAll && (
        <select value={scope} onChange={(e) => setScope(e.currentTarget.value)} aria-label={t('common.store')} style={{ marginBottom: 8 }}>
          <option value="*">{t('reports.allStores')}</option>
          {s.stores.map((st) => (
            <option value={st.id}>{st.name}</option>
          ))}
        </select>
      )}
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sales', label: t('reports.tabSales') },
          { value: 'products', label: t('reports.tabProducts') },
          { value: 'debts', label: t('reports.tabDebts') },
          { value: 'stock', label: t('reports.tabStock') },
        ]}
      />
      {(tab === 'sales' || tab === 'products') && (
        <div class="chips" style={{ marginTop: 8 }}>
          {(['today', 'yesterday', '7d', '30d'] as Period[]).map((p) => (
            <button class={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{t(`period.${p}`)}</button>
          ))}
        </div>
      )}
      {tab === 'sales' && <SalesReport storeId={storeId} from={from} to={to} period={period} />}
      {tab === 'products' && <ProductsReport storeId={storeId} from={from} to={to} />}
      {tab === 'debts' && <DebtsReport />}
      {tab === 'stock' && <StockReport storeId={storeId} />}
    </Page>
  );
}

function useDocs(storeId: string | null, from: number, to: number) {
  const sales = useLive(
    () => (storeId ? db.sale.where('[storeId+at]').between([storeId, from], [storeId, to]).toArray() : db.sale.where('at').between(from, to).toArray()) as Promise<Sale[]>,
    [storeId, from, to],
    [] as Sale[],
  );
  const voids = useLive(() => db.sale_void.toArray() as Promise<SaleVoid[]>, [], [] as SaleVoid[]);
  const reps = useLive(
    async () => {
      const rev = new Set((await db.reversal.toArray()).map((r: any) => r.refId));
      const r = (await db.repayment.where('at').between(from, to).toArray()) as Repayment[];
      return r.filter((x) => (!storeId || x.storeId === storeId) && !rev.has(x.id));
    },
    [storeId, from, to],
    [] as Repayment[],
  );
  return { sales, voids, reps };
}

function SalesReport(props: { storeId: string | null; from: number; to: number; period: Period }) {
  const s = useSession();
  const { sales, voids, reps } = useDocs(props.storeId, props.from, props.to);
  const act = activeSales(sales, voids);
  const names = Object.fromEntries(s.users.map((u) => [u.id, u.name]));

  const agg = useMemo(() => {
    let total = 0, cost = 0, discount = 0, credit = 0;
    const byMethod: Record<string, number> = {};
    const bySeller: Record<string, { n: number; usd: number }> = {};
    const byStore: Record<string, { n: number; usd: number; margin: number }> = {};
    const byDay: Record<string, number> = {};
    for (const x of act) {
      const c = saleCost(x);
      total += x.totalUSD;
      cost += c;
      discount += x.discountUSD;
      for (const [k, v] of Object.entries(collected(x))) byMethod[k] = round2((byMethod[k] ?? 0) + v);
      credit += x.payments.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amountUSD, 0);
      const se = (bySeller[x.userId] ??= { n: 0, usd: 0 });
      se.n++;
      se.usd += x.totalUSD;
      const st = (byStore[x.storeId] ??= { n: 0, usd: 0, margin: 0 });
      st.n++;
      st.usd += x.totalUSD;
      st.margin += x.totalUSD - c;
      const d = dayKey(x.at);
      byDay[d] = (byDay[d] ?? 0) + x.totalUSD;
    }
    const repaid = reps.reduce((a, r) => a + r.amountUSD, 0);
    return { total: round2(total), cost: round2(cost), margin: round2(total - cost), discount: round2(discount), credit: round2(credit), repaid: round2(repaid), byMethod, bySeller, byStore, byDay };
  }, [sales, voids, reps]);

  const share = () => {
    const day = dayKey(props.from + 3_600_000);
    const sum = daySummary(day, props.storeId, sales, voids, reps);
    const name = props.storeId ? s.stores.find((x) => x.id === props.storeId)?.name ?? '' : t('reports.allStores');
    sendWhatsApp({ kind: 'daily_summary', text: dailySummaryText(t, sum, name, names), to: null });
  };
  const days = Object.entries(agg.byDay).sort();
  const maxDay = Math.max(1, ...days.map(([, v]) => v));
  const marginPct = agg.total ? Math.round((agg.margin / agg.total) * 100) : 0;

  return (
    <>
      <div class="headline">
        <div class="label">{t('reports.revenue')} · {t('reports.salesCount', { n: act.length })}</div>
        <div class="big">{fmtUSD(agg.total)}</div>
        <div class="cdf">{fmtCDF(usdToCdf(agg.total, s.rate))}</div>
      </div>
      <table class="facts">
        <tbody>
          <tr><th>{t('reports.margin')}</th><td class="n"><b>{fmtUSD(agg.margin)}</b> <span class="muted">({marginPct}%)</span></td></tr>
          <tr><th>{t('reports.cost')}</th><td class="n">{fmtUSD(agg.cost)}</td></tr>
          <tr><th>{t('reports.discounts')}</th><td class="n">{fmtUSD(agg.discount)}</td></tr>
          <tr><th>{t('reports.creditGiven')}</th><td class="n">{fmtUSD(agg.credit)}</td></tr>
          <tr><th>{t('reports.repaid')}</th><td class="n">{fmtUSD(agg.repaid)}</td></tr>
          <tr><th>{t('reports.voided')}</th><td class="n">{sales.length - act.length}</td></tr>
        </tbody>
      </table>
      {(props.period === 'today' || props.period === 'yesterday') && (
        <div class="row" style={{ marginTop: 12 }}>
          <button class="btn wa grow" onClick={share}><Icon.whatsapp />{t('reports.shareDay')}</button>
          {props.storeId && s.can('cash.close') && <a class="btn" href="#/cash">{t('reports.cashClose')}</a>}
        </div>
      )}
      <div class="row" style={{ marginTop: 8 }}>
        <a class="btn small" href="#/sales">{t('reports.salesList')}</a>
      </div>

      <Section title={t('reports.byMethod')} />
      <table class="facts">
        <tbody>
          {Object.entries(agg.byMethod).sort().map(([k, v]) => {
            const [m, c] = k.split(':');
            return <tr><th>{t(`pay.${m}`)} ({c === 'USD' ? 'USD' : 'FC'})</th><td class="n">{c === 'USD' ? fmtUSD(v) : fmtCDF(v)}</td></tr>;
          })}
          {agg.credit > 0 && <tr><th>{t('pay.credit')}</th><td class="n">{fmtUSD(agg.credit)}</td></tr>}
        </tbody>
      </table>

      {!props.storeId && (
        <>
          <Section title={t('reports.byStore')} />
          <table class="facts">
            <thead><tr><th>{t('common.store')}</th><th class="n">{t('reports.salesShort')}</th><th class="n">{t('reports.revenue')}</th><th class="n">{t('reports.margin')}</th></tr></thead>
            <tbody>
              {s.stores.map((st) => {
                const v = agg.byStore[st.id] ?? { n: 0, usd: 0, margin: 0 };
                return <tr><td>{st.name}</td><td class="n">{v.n}</td><td class="n">{fmtUSD(v.usd)}</td><td class="n">{fmtUSD(v.margin)}</td></tr>;
              })}
            </tbody>
          </table>
        </>
      )}

      <Section title={t('reports.bySeller')} />
      <table class="facts">
        <thead><tr><th>{t('reports.seller')}</th><th class="n">{t('reports.salesShort')}</th><th class="n">{t('reports.revenue')}</th></tr></thead>
        <tbody>
          {Object.entries(agg.bySeller).sort((a, b) => b[1].usd - a[1].usd).map(([uid, v]) => (
            <tr><td>{names[uid] ?? uid}</td><td class="n">{v.n}</td><td class="n">{fmtUSD(v.usd)}</td></tr>
          ))}
        </tbody>
      </table>
      {!act.length && <Empty>{t('reports.noSales')}</Empty>}

      {days.length > 1 && (
        <>
          <Section title={t('reports.byDay')} />
          <table class="facts">
            <tbody>
              {days.reverse().map(([d, v]) => (
                <tr>
                  <td style={{ width: '32%' }}>{fmtDate(dayStart(d) + 3_600_000)}</td>
                  <td>
                    <div style={{ background: 'var(--navy)', height: 14, width: `${Math.max(2, (v / maxDay) * 100)}%` }} aria-hidden="true" />
                  </td>
                  <td class="n">{fmtUSD(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function ProductsReport(props: { storeId: string | null; from: number; to: number }) {
  const s = useSession();
  const { sales, voids } = useDocs(props.storeId, props.from, props.to);
  const stock = useStock(props.storeId);
  const stats = useMemo(() => productStats(activeSales(sales, voids), props.storeId, props.from, props.to), [sales, voids]);
  const best = [...stats.values()].sort((a, b) => b.revenueUSD - a.revenueUSD).slice(0, 15);
  // slow movers: in stock, not sold in the last 30 days
  const since = engine.now() - 30 * DAY_MS;
  const recent = useLive(
    () => (props.storeId ? db.sale.where('[storeId+at]').between([props.storeId, since], [props.storeId, Infinity]).toArray() : db.sale.where('at').above(since).toArray()) as Promise<Sale[]>,
    [props.storeId],
    [] as Sale[],
  );
  const sold30 = new Set(recent.flatMap((x) => x.lines.map((l) => l.productId)));
  const qtyOf = (pid: string) => {
    if (props.storeId) return stock.get(pid) ?? 0;
    return s.stores.reduce((a, st) => a + (stock.get(`${st.id}:${pid}`) ?? 0), 0);
  };
  const slow = s.products
    .filter((p) => p.active && !sold30.has(p.id) && qtyOf(p.id) > 0)
    .map((p) => ({ p, qty: qtyOf(p.id), value: round2(qtyOf(p.id) * p.costUSD) }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <Section title={t('reports.best')} />
      <table class="facts">
        <thead><tr><th>{t('reports.product')}</th><th class="n">{t('reports.qty')}</th><th class="n">{t('reports.revenue')}</th><th class="n">{t('reports.margin')}</th></tr></thead>
        <tbody>
          {best.map((b) => {
            const p = s.productById.get(b.productId);
            return (
              <tr>
                <td><a href={`#/product/${b.productId}`}>{p?.name ?? b.productId}</a><div class="muted">{p?.ref}</div></td>
                <td class="n">{b.qty}</td>
                <td class="n">{fmtUSD(b.revenueUSD)}</td>
                <td class="n">{fmtUSD(round2(b.revenueUSD - b.costUSD))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!best.length && <Empty>{t('reports.noSales')}</Empty>}
      <Section title={t('reports.slow')} />
      <p class="muted">{t('reports.slowHint')}</p>
      <table class="facts">
        <thead><tr><th>{t('reports.product')}</th><th class="n">{t('reports.qty')}</th><th class="n">{t('reports.tiedUp')}</th></tr></thead>
        <tbody>
          {slow.slice(0, 30).map((x) => (
            <tr><td><a href={`#/product/${x.p.id}`}>{x.p.name}</a><div class="muted">{x.p.ref}</div></td><td class="n">{x.qty}</td><td class="n">{fmtUSD(x.value)}</td></tr>
          ))}
        </tbody>
      </table>
      {!slow.length && <Empty>{t('reports.noSlow')}</Empty>}
    </>
  );
}

function DebtsReport() {
  const s = useSession();
  const ledger = useLive(() => db.ledger.toArray() as Promise<LedgerEntry[]>, [], [] as LedgerEntry[]);
  const bal = useMemo(() => [...customerBalances(ledger, engine.now()).values()].filter((b) => b.balanceUSD > 0.004), [ledger]);
  const tot = bal.reduce(
    (a, b) => ({ d0_30: a.d0_30 + b.buckets.d0_30, d31_60: a.d31_60 + b.buckets.d31_60, d61_90: a.d61_90 + b.buckets.d61_90, d90p: a.d90p + b.buckets.d90p }),
    { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 },
  );
  const total = round2(bal.reduce((a, b) => a + b.balanceUSD, 0));
  const names = new Map(s.customers.map((c) => [c.id, c.name]));
  return (
    <>
      <div class="headline">
        <div class="label">{t('reports.debtTotal', { n: bal.length })}</div>
        <div class="big">{fmtUSD(total)}</div>
      </div>
      <p class="muted">{t('reports.debtsAllStores')}</p>
      <div class="scroll-x">
        <table class="facts">
          <thead>
            <tr><th>{t('cart.customer')}</th><th class="n">{t('aging.short0')}</th><th class="n">{t('aging.short31')}</th><th class="n">{t('aging.short61')}</th><th class="n">{t('aging.short90')}</th><th class="n">{t('reports.total')}</th></tr>
          </thead>
          <tbody>
            {bal.sort((a, b) => b.balanceUSD - a.balanceUSD).map((b) => (
              <tr>
                <td><a href={`#/customer/${b.customerId}`}>{names.get(b.customerId) ?? b.customerId}</a></td>
                <td class="n">{b.buckets.d0_30 ? fmtUSD(b.buckets.d0_30) : '—'}</td>
                <td class="n">{b.buckets.d31_60 ? fmtUSD(b.buckets.d31_60) : '—'}</td>
                <td class={`n ${b.buckets.d61_90 ? 'low' : ''}`}>{b.buckets.d61_90 ? fmtUSD(b.buckets.d61_90) : '—'}</td>
                <td class={`n ${b.buckets.d90p ? 'neg' : ''}`}>{b.buckets.d90p ? fmtUSD(b.buckets.d90p) : '—'}</td>
                <td class="n"><b>{fmtUSD(b.balanceUSD)}</b></td>
              </tr>
            ))}
            <tr class="total">
              <td>{t('reports.total')}</td>
              <td class="n">{fmtUSD(round2(tot.d0_30))}</td>
              <td class="n">{fmtUSD(round2(tot.d31_60))}</td>
              <td class="n">{fmtUSD(round2(tot.d61_90))}</td>
              <td class="n">{fmtUSD(round2(tot.d90p))}</td>
              <td class="n">{fmtUSD(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function StockReport(props: { storeId: string | null }) {
  const s = useSession();
  const all = useStock(null);
  const stores = props.storeId ? s.stores.filter((x) => x.id === props.storeId) : s.stores;
  const rows = stores.map((st) => {
    let cost = 0, retail = 0, units = 0, neg = 0;
    for (const p of s.products) {
      if (!p.active) continue;
      const q = all.get(`${st.id}:${p.id}`) ?? 0;
      if (q < 0) neg++;
      const qq = Math.max(0, q);
      units += qq;
      cost += qq * p.costUSD;
      retail += qq * p.priceUSD;
    }
    return { st, cost: round2(cost), retail: round2(retail), units, neg };
  });
  const sum = rows.reduce((a, r) => ({ cost: a.cost + r.cost, retail: a.retail + r.retail, units: a.units + r.units }), { cost: 0, retail: 0, units: 0 });
  return (
    <>
      <Section title={t('reports.stockValue')} />
      <div class="scroll-x">
        <table class="facts">
          <thead><tr><th>{t('common.store')}</th><th class="n">{t('reports.units')}</th><th class="n">{t('reports.atCost')}</th><th class="n">{t('reports.atPrice')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr>
                <td>{r.st.name}{r.neg > 0 && <div><span class="tag bad">{t('reports.negCount', { n: r.neg })}</span></div>}</td>
                <td class="n">{r.units}</td>
                <td class="n">{fmtUSD(r.cost)}</td>
                <td class="n">{fmtUSD(r.retail)}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr class="total"><td>{t('reports.total')}</td><td class="n">{sum.units}</td><td class="n">{fmtUSD(round2(sum.cost))}</td><td class="n">{fmtUSD(round2(sum.retail))}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p><a href="#/stock">{t('reports.toLowStock')}</a></p>
    </>
  );
}

/** Sellers do not see the store reports, only their own sales of the day. */
function SellerDay() {
  const s = useSession();
  const today = dayKey(engine.now());
  const { sales, voids } = useDocs(s.storeId, dayStart(today), dayStart(today) + DAY_MS);
  const mine = activeSales(sales, voids).filter((x) => x.userId === s.user.id);
  const total = round2(mine.reduce((a, x) => a + x.totalUSD, 0));
  return (
    <Page title={t('reports.myDay')}>
      <div class="headline">
        <div class="label">{t('reports.salesCount', { n: mine.length })}</div>
        <div class="big">{fmtUSD(total)}</div>
      </div>
      <a class="btn block" href="#/sales">{t('reports.salesList')}</a>
    </Page>
  );
}
