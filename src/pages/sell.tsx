// Checkout. A common sale is 3 taps: the part, "Encaisser", the payment method.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { db, engine, go, t, toast, useLive, useSession, useStock } from '../state';
import { Icon, Money, Qty, Sheet, Field, Seg, Empty, matchProduct, fitsText, useDebounced, norm } from '../ui';
import { Scanner } from '../scanner';
import { fmtCDF, fmtUSD, productPriceCDF, round2, roundCdf, toUSD, usdToCdf } from '../../shared/money';
import { productStats } from '../../shared/reports';
import { customerBalances } from '../../shared/reports';
import type { Currency, Customer, PayMethod, Payment, Product, Sale } from '../../shared/types';
import { DAY_MS } from '../../shared/time';
import { ulid } from 'ulid';

interface CartLine {
  productId: string;
  qty: number;
  unitUSD: number;
}
interface Cart {
  lines: CartLine[];
  customerId: string | null;
  discountUSD: number;
  note: string;
}
const EMPTY: Cart = { lines: [], customerId: null, discountUSD: 0, note: '' };
const CART_KEY = 'cart';

function loadCart(): Cart {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(CART_KEY) ?? 'null') };
  } catch {
    return EMPTY;
  }
}

export function SellPage() {
  const s = useSession();
  const stock = useStock(s.storeId);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 120);
  const [scan, setScan] = useState(false);
  const [cart, setCartState] = useState<Cart>(loadCart);
  const [sheet, setSheet] = useState<null | 'cart' | 'pay' | 'mixed' | 'customer' | 'confirmCredit'>(null);
  const [creditCustomer, setCreditCustomer] = useState<string | null>(null);
  const [afterCustomer, setAfterCustomer] = useState<null | 'credit' | 'mixed' | 'cart'>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setCart = (c: Cart) => {
    setCartState(c);
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(c));
    } catch {}
  };

  // Most sold parts in this store over 30 days, shown before typing.
  const top = useLive(
    async () => {
      const since = engine.now() - 30 * DAY_MS;
      const sales = await db.sale.where('[storeId+at]').between([s.storeId, since], [s.storeId, Infinity]).toArray();
      return [...productStats(sales, s.storeId, since, Infinity).values()].sort((a, b) => b.qty - a.qty).slice(0, 25).map((x) => x.productId);
    },
    [s.storeId],
    [] as string[],
  );

  const active = s.products.filter((p) => p.active);
  const results = useMemo(() => {
    if (!dq.trim()) return top.map((id) => s.productById.get(id)).filter((p): p is Product => !!p && p.active);
    return active.filter((p) => matchProduct(p, dq)).slice(0, 60);
  }, [dq, top, s.products]);

  const add = (p: Product, qty = 1) => {
    const lines = [...cart.lines];
    const i = lines.findIndex((l) => l.productId === p.id);
    if (i >= 0) lines[i] = { ...lines[i], qty: lines[i].qty + qty };
    else lines.push({ productId: p.id, qty, unitUSD: p.priceUSD });
    setCart({ ...cart, lines });
    toast(t('sell.added', { name: p.name }));
  };

  const byCode = (code: string): Product | undefined => {
    const c = norm(code.trim());
    return active.find((p) => (p.barcode && norm(p.barcode) === c) || norm(p.ref) === c);
  };

  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const p = byCode(q) ?? (results.length === 1 ? results[0] : undefined);
    if (p) {
      add(p);
      setQ('');
    }
  };

  const gross = round2(cart.lines.reduce((a, l) => a + l.qty * l.unitUSD, 0));
  const total = round2(Math.max(0, gross - cart.discountUSD));
  const count = cart.lines.reduce((a, l) => a + l.qty, 0);
  // Price in francs: uses the fixed FC price of a part when it has one (and was not changed in the cart).
  const totalCDF = cdfTotal(cart, s.productById, s.rate);

  const finish = async (payments: Payment[], customerId: string | null = cart.customerId, extraDiscount = 0) => {
    const discountUSD = round2(cart.discountUSD + extraDiscount);
    const saleTotal = round2(total - extraDiscount);
    const paid = round2(payments.reduce((a, p) => a + p.amountUSD, 0));
    let change = round2(Math.max(0, paid - saleTotal));
    // differences smaller than the smallest CDF note are rounding, not change to give back
    if (change < 50 / s.rate && payments.some((p) => p.currency === 'CDF')) change = 0;
    const lines = cart.lines.map((l) => {
      const p = s.productById.get(l.productId)!;
      return { productId: p.id, name: p.name, ref: p.ref, qty: l.qty, unitUSD: l.unitUSD, costUSD: p.costUSD };
    });
    const no = await engine.nextReceiptNo(s.store.code);
    const sale = await engine.createDoc<Sale>('sale', s.user.id, s.storeId, {
      no,
      customerId,
      rate: s.rate,
      lines,
      discountUSD,
      totalUSD: saleTotal,
      payments,
      changeUSD: change,
      note: cart.note || undefined,
    });
    setCart(EMPTY);
    setSheet(null);
    go(`/sale/${sale.id}?new=1`);
  };

  const quickPay = (method: PayMethod, currency: Currency) => {
    if (method === 'credit') {
      // Credit always goes through a confirmation showing who will owe how much.
      if (!cart.customerId) {
        setAfterCustomer('credit');
        return setSheet('customer');
      }
      setCreditCustomer(cart.customerId);
      return setSheet('confirmCredit');
    }
    if (currency === 'CDF') {
      const amount = totalCDF;
      const amountUSD = toUSD(amount, 'CDF', s.rate);
      // fixed FC prices can come to slightly less than the USD price: the gap is recorded as a discount
      return finish([{ method, currency, amount, amountUSD }], cart.customerId, Math.max(0, round2(total - amountUSD)));
    }
    finish([{ method, currency, amount: total, amountUSD: total }]);
  };

  return (
    <div class={cart.lines.length ? 'with-cart' : ''}>
      <div class="row" style={{ marginBottom: 8 }}>
        <div class="search grow">
          <input
            ref={inputRef}
            type="search"
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={onEnter}
            placeholder={t('sell.searchPh')}
            aria-label={t('sell.search')}
            enterKeyHint="search"
          />
        </div>
        <button class="btn dark compact" onClick={() => setScan(!scan)}>
          <Icon.scan />
          {t('sell.scan')}
        </button>
      </div>
      {scan && (
        <Scanner
          onClose={() => setScan(false)}
          onCode={(code) => {
            setScan(false);
            const p = byCode(code);
            if (p) add(p);
            else {
              setQ(code);
              toast(t('sell.codeUnknown', { code }), 'error');
            }
          }}
        />
      )}
      <h2 style={{ margin: '12px 0 4px' }}>{dq.trim() ? t('sell.results', { n: results.length }) : t('sell.top')}</h2>
      <div class="list">
        {results.map((p) => {
          const qty = stock.get(p.id) ?? 0;
          const inCart = cart.lines.find((l) => l.productId === p.id)?.qty;
          return (
            <button class="item" onClick={() => add(p)}>
              <div class="main">
                <div class="title">{p.name}</div>
                <div class="sub">
                  {p.ref} · {fitsText(p)}
                </div>
                <div class="sub">
                  {t('sell.inStock')} <Qty n={qty} min={0} />
                  {inCart ? <b> · {t('sell.inCart', { n: inCart })}</b> : null}
                </div>
              </div>
              <div class="end">
                <Money usd={p.priceUSD} cdf={productPriceCDF(p, s.rate)} />
              </div>
            </button>
          );
        })}
        {!results.length && <Empty>{dq.trim() ? t('sell.noResult') : t('sell.noTop')}</Empty>}
      </div>

      {cart.lines.length > 0 && (
        <div class="cartbar">
          <button class="count" onClick={() => setSheet('cart')}>
            <b>{t('sell.cartCount', { n: count })}</b>
            <span class="muted">{t('sell.seeCart')}</span>
          </button>
          <button class="btn primary" onClick={() => setSheet('pay')}>
            {t('sell.checkout', { total: fmtUSD(total) })}
          </button>
        </div>
      )}

      {sheet === 'cart' && (
        <CartSheet
          cart={cart}
          setCart={setCart}
          total={total}
          gross={gross}
          onClose={() => setSheet(null)}
          onPay={() => setSheet('pay')}
          onCustomer={() => {
            setAfterCustomer('cart');
            setSheet('customer');
          }}
        />
      )}
      {sheet === 'pay' && (
        <Sheet title={t('pay.title')} onClose={() => setSheet(null)}>
          <div class="headline">
            <div class="label">{t('pay.toPay')}</div>
            <div class="big">{fmtUSD(total)}</div>
            <div class="usd" style={{ fontWeight: 700 }}>{fmtCDF(totalCDF)}</div>
          </div>
          <div class="paygrid">
            <button class="btn primary" onClick={() => quickPay('cash', 'USD')}>{t('pay.cashUSD')}</button>
            <button class="btn primary" onClick={() => quickPay('cash', 'CDF')}>{t('pay.cashCDF')}</button>
            <button class="btn" onClick={() => quickPay('mpesa', 'USD')}>{t('pay.mpesa')}</button>
            <button class="btn" onClick={() => quickPay('airtel', 'USD')}>{t('pay.airtel')}</button>
            <button class="btn" onClick={() => quickPay('orange', 'USD')}>{t('pay.orange')}</button>
            <button class="btn" onClick={() => quickPay('credit', 'USD')}>{t('pay.credit')}</button>
          </div>
          <p class="muted">{t('pay.mobileHint')}</p>
          <button class="btn block" style={{ marginTop: 8 }} onClick={() => setSheet('mixed')}>
            {t('pay.mixed')}
          </button>
        </Sheet>
      )}
      {sheet === 'mixed' && (
        <MixedSheet
          total={total}
          customer={cart.customerId ? s.customers.find((c) => c.id === cart.customerId) ?? null : null}
          onClose={() => setSheet(null)}
          onBack={() => setSheet('pay')}
          onPickCustomer={() => {
            setAfterCustomer('mixed');
            setSheet('customer');
          }}
          onConfirm={(payments) => finish(payments)}
        />
      )}
      {sheet === 'customer' && (
        <CustomerSheet
          onClose={() => setSheet(afterCustomer === 'cart' ? 'cart' : 'pay')}
          onPick={(c) => {
            const next = { ...cart, customerId: c.id };
            setCart(next);
            if (afterCustomer === 'credit') {
              setCreditCustomer(c.id);
              setSheet('confirmCredit');
            } else setSheet(afterCustomer === 'mixed' ? 'mixed' : 'cart');
          }}
        />
      )}
      {sheet === 'confirmCredit' && creditCustomer && (
        <CreditConfirmSheet
          customerId={creditCustomer}
          total={total}
          onClose={() => setSheet(null)}
          onOther={() => {
            setAfterCustomer('credit');
            setSheet('customer');
          }}
          onConfirm={() => finish([{ method: 'credit', currency: 'USD', amount: total, amountUSD: total }], creditCustomer)}
        />
      )}
    </div>
  );
}

function CreditConfirmSheet(props: { customerId: string; total: number; onClose: () => void; onOther: () => void; onConfirm: () => void }) {
  const s = useSession();
  const c = s.customers.find((x) => x.id === props.customerId);
  const ledger = useLive(() => db.ledger.where('customerId').equals(props.customerId).toArray(), [props.customerId], [] as any[]);
  const [busy, setBusy] = useState(false);
  const before = round2(ledger.reduce((a: number, e: any) => a + e.amountUSD, 0));
  const after = round2(before + props.total);
  const over = c?.creditLimitUSD != null && after > c.creditLimitUSD;
  return (
    <Sheet title={t('credit.confirmTitle')} onClose={props.onClose}>
      <div class="headline">
        <div class="label">{c?.name}</div>
        <div class="big">{fmtUSD(props.total)}</div>
        <div class="cdf">{fmtCDF(usdToCdf(props.total, s.rate))}</div>
      </div>
      <table class="facts">
        <tbody>
          <tr><th>{t('credit.before')}</th><td class="n">{fmtUSD(before)}</td></tr>
          <tr class="total"><td>{t('credit.after')}</td><td class={`n ${over ? 'neg' : ''}`}>{fmtUSD(after)}</td></tr>
          {c?.creditLimitUSD != null && <tr><th>{t('credit.limit')}</th><td class="n">{fmtUSD(c.creditLimitUSD)}</td></tr>}
        </tbody>
      </table>
      {over && <div class="notice bad" style={{ marginTop: 10 }}>{t('credit.overLimit')}</div>}
      <div class="row" style={{ marginTop: 12 }}>
        <button class="btn" onClick={props.onOther}>{t('credit.otherCustomer')}</button>
        <button
          class={`btn grow ${over ? 'danger solid' : 'primary'}`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            props.onConfirm();
          }}
        >
          {over ? t('credit.confirmOver') : t('credit.confirm')}
        </button>
      </div>
    </Sheet>
  );
}

function cdfTotal(cart: Cart, products: Map<string, Product>, rate: number): number {
  let sum = 0;
  for (const l of cart.lines) {
    const p = products.get(l.productId);
    const unit = p && p.priceCDF && p.priceCDF > 0 && l.unitUSD === p.priceUSD ? p.priceCDF : l.unitUSD * rate;
    sum += unit * l.qty;
  }
  return roundCdf(Math.max(0, sum - cart.discountUSD * rate));
}

function CartSheet(props: { cart: Cart; setCart: (c: Cart) => void; total: number; gross: number; onClose: () => void; onPay: () => void; onCustomer: () => void }) {
  const s = useSession();
  const { cart, setCart } = props;
  const customer = cart.customerId ? s.customers.find((c) => c.id === cart.customerId) : null;
  const [discountMode, setDiscountMode] = useState<'usd' | 'pct'>('usd');
  const [discountInput, setDiscountInput] = useState(cart.discountUSD ? String(cart.discountUSD) : '');

  const update = (i: number, patch: Partial<CartLine>) => {
    const lines = cart.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)).filter((l) => l.qty > 0);
    setCart({ ...cart, lines });
    if (!lines.length) props.onClose();
  };
  const applyDiscount = (raw: string, mode = discountMode) => {
    setDiscountInput(raw);
    const n = Math.max(0, Number(raw.replace(',', '.')) || 0);
    const usd = mode === 'pct' ? round2((props.gross * Math.min(n, 100)) / 100) : Math.min(n, props.gross);
    setCart({ ...cart, discountUSD: round2(usd) });
  };

  return (
    <Sheet title={t('cart.title')} onClose={props.onClose}>
      <div class="list">
        {cart.lines.map((l, i) => {
          const p = s.productById.get(l.productId);
          return (
            <div class="item" style={{ flexWrap: 'wrap', cursor: 'default' }}>
              <div class="main" style={{ minWidth: '60%' }}>
                <div class="title">{p?.name}</div>
                <div class="sub">{p?.ref}</div>
              </div>
              <div class="end usd">{fmtUSD(l.qty * l.unitUSD)}</div>
              <div class="row" style={{ width: '100%' }}>
                <div class="stepper">
                  <button aria-label={t('cart.less')} onClick={() => update(i, { qty: l.qty - 1 })}>−</button>
                  <input inputMode="numeric" value={l.qty} aria-label={t('cart.qty')} onChange={(e) => update(i, { qty: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                  <button aria-label={t('cart.more')} onClick={() => update(i, { qty: l.qty + 1 })}>+</button>
                </div>
                <label class="grow field" style={{ minWidth: 110 }}>
                  <span>{t('cart.unitPrice')}</span>
                  <input
                    inputMode="decimal"
                    value={l.unitUSD}
                    onChange={(e) => update(i, { unitUSD: Math.max(0, round2(Number(e.currentTarget.value.replace(',', '.')) || 0)) })}
                  />
                </label>
                <button class="btn danger small" onClick={() => update(i, { qty: 0 })}>{t('cart.remove')}</button>
              </div>
            </div>
          );
        })}
      </div>
      <div class="stack" style={{ marginTop: 12 }}>
        <div class="row">
          <div class="grow">
            <b>{t('cart.customer')}</b>
            <div class="muted">{customer ? customer.name : t('cart.noCustomer')}</div>
          </div>
          <button class="btn small" onClick={props.onCustomer}>{customer ? t('common.change') : t('cart.pickCustomer')}</button>
          {customer && (
            <button class="btn small" onClick={() => setCart({ ...cart, customerId: null })}>
              {t('common.remove')}
            </button>
          )}
        </div>
        <Field label={t('cart.discount')}>
          <div class="row">
            <input class="grow" style={{ flex: 1 }} inputMode="decimal" value={discountInput} onInput={(e) => applyDiscount(e.currentTarget.value)} placeholder="0" />
            <Seg
              value={discountMode}
              options={[
                { value: 'usd', label: '$' },
                { value: 'pct', label: '%' },
              ]}
              onChange={(m) => {
                setDiscountMode(m);
                applyDiscount(discountInput, m);
              }}
            />
          </div>
        </Field>
        <Field label={t('cart.note')}>
          <input value={cart.note} onInput={(e) => setCart({ ...cart, note: e.currentTarget.value })} placeholder={t('cart.notePh')} />
        </Field>
        <table class="facts">
          <tbody>
            <tr>
              <th>{t('cart.subtotal')}</th>
              <td class="n">{fmtUSD(props.gross)}</td>
            </tr>
            {cart.discountUSD > 0 && (
              <tr>
                <th>{t('cart.discount')}</th>
                <td class="n">-{fmtUSD(cart.discountUSD)}</td>
              </tr>
            )}
            <tr class="total">
              <td>{t('cart.total')}</td>
              <td class="n">
                {fmtUSD(props.total)} <span class="cdf">{fmtCDF(cdfTotal(cart, s.productById, s.rate))}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="row">
          <button class="btn danger" onClick={() => { setCart(EMPTY); props.onClose(); }}>
            {t('cart.clear')}
          </button>
          <button class="btn primary grow" onClick={props.onPay}>
            {t('sell.checkout', { total: fmtUSD(props.total) })}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

interface PayRow {
  method: PayMethod;
  currency: Currency;
  amount: string;
}

function MixedSheet(props: { total: number; customer: Customer | null; onClose: () => void; onBack: () => void; onPickCustomer: () => void; onConfirm: (p: Payment[]) => void }) {
  const s = useSession();
  const [rows, setRows] = useState<PayRow[]>([{ method: 'cash', currency: 'USD', amount: '' }]);
  const payments: Payment[] = rows
    .map((r) => {
      const amount = Math.max(0, Number(r.amount.replace(',', '.')) || 0);
      return { method: r.method, currency: r.method === 'credit' ? 'USD' : r.currency, amount, amountUSD: toUSD(amount, r.method === 'credit' ? 'USD' : r.currency, s.rate) } as Payment;
    })
    .filter((p) => p.amount > 0);
  const paid = round2(payments.reduce((a, p) => a + p.amountUSD, 0));
  const left = round2(props.total - paid);
  const hasCredit = payments.some((p) => p.method === 'credit');
  const set = (i: number, patch: Partial<PayRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const fillRest = (i: number) => {
    const r = rows[i];
    const rest = Math.max(0, round2(left + (Number(r.amount) ? toUSD(Number(r.amount), r.currency, s.rate) : 0)));
    set(i, { amount: String(r.currency === 'CDF' && r.method !== 'credit' ? roundCdf(rest * s.rate) : rest) });
  };
  const methods: PayMethod[] = ['cash', 'mpesa', 'airtel', 'orange', 'credit'];

  return (
    <Sheet title={t('pay.mixedTitle')} onClose={props.onClose}>
      <div class="headline">
        <div class="label">{t('pay.toPay')}</div>
        <div class="usd">
          {fmtUSD(props.total)} <span class="cdf">{fmtCDF(usdToCdf(props.total, s.rate))}</span>
        </div>
      </div>
      <div class="stack">
        {rows.map((r, i) => (
          <div class="stack" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
            <div class="grid2">
              <select value={r.method} onChange={(e) => set(i, { method: e.currentTarget.value as PayMethod })} aria-label={t('pay.method')}>
                {methods.map((m) => (
                  <option value={m}>{t(`pay.${m}`)}</option>
                ))}
              </select>
              {r.method !== 'credit' ? (
                <Seg value={r.currency} options={[{ value: 'USD', label: 'USD' }, { value: 'CDF', label: 'FC' }]} onChange={(c) => set(i, { currency: c, amount: '' })} />
              ) : (
                <div class="muted" style={{ alignSelf: 'center' }}>USD</div>
              )}
            </div>
            <div class="row">
              <input class="grow" style={{ flex: 1 }} inputMode="decimal" value={r.amount} onInput={(e) => set(i, { amount: e.currentTarget.value })} placeholder={t('pay.amount')} aria-label={t('pay.amount')} />
              <button class="btn small" onClick={() => fillRest(i)}>{t('pay.rest')}</button>
              {rows.length > 1 && (
                <button class="btn small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  {t('common.remove')}
                </button>
              )}
            </div>
          </div>
        ))}
        <button class="btn" onClick={() => setRows([...rows, { method: 'cash', currency: 'CDF', amount: '' }])}>
          <Icon.plus />
          {t('pay.addPayment')}
        </button>
        {hasCredit && (
          <div class="row">
            <div class="grow">
              <b>{t('cart.customer')}</b>
              <div class={props.customer ? '' : 'neg'}>{props.customer ? props.customer.name : t('pay.creditNeedsCustomer')}</div>
            </div>
            <button class="btn small" onClick={props.onPickCustomer}>{props.customer ? t('common.change') : t('cart.pickCustomer')}</button>
          </div>
        )}
        <table class="facts">
          <tbody>
            <tr>
              <th>{t('pay.received')}</th>
              <td class="n">{fmtUSD(paid)}</td>
            </tr>
            {left > 0.004 ? (
              <tr class="total">
                <td>{t('pay.remaining')}</td>
                <td class="n neg">
                  {fmtUSD(left)} <span class="cdf">{fmtCDF(usdToCdf(left, s.rate))}</span>
                </td>
              </tr>
            ) : (
              <tr class="total">
                <td>{t('pay.change')}</td>
                <td class="n">
                  {fmtUSD(-left)} <span class="cdf">{fmtCDF(Math.max(0, Math.round((-left * s.rate) / 50) * 50))}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div class="row">
          <button class="btn" onClick={props.onBack}>{t('common.back')}</button>
          <button class="btn primary grow" disabled={left > 0.004 || (hasCredit && !props.customer)} onClick={() => props.onConfirm(payments)}>
            {t('pay.confirm')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function CustomerSheet(props: { onClose: () => void; onPick: (c: Customer) => void }) {
  const s = useSession();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const ledger = useLive(() => db.ledger.toArray(), [], [] as any[]);
  const balances = useMemo(() => customerBalances(ledger, engine.now()), [ledger]);
  const list = s.customers
    .filter((c) => c.active && (!q || norm(`${c.name} ${c.phone ?? ''}`).includes(norm(q))))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50);

  const create = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = `c_${ulid()}`;
    await engine.patch('customer', id, s.user.id, { name: name.trim(), phone: phone.trim(), note: '', active: true });
    toast(t('toast.created', { what: name.trim() }), 'success');
    props.onPick({ id, name: name.trim(), phone: phone.trim(), active: true });
  };

  return (
    <Sheet title={creating ? t('customer.new') : t('cart.pickCustomer')} onClose={props.onClose}>
      {creating ? (
        <form class="stack" onSubmit={create}>
          <Field label={t('customer.name')}>
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} required />
          </Field>
          <Field label={t('customer.phone')} hint={t('customer.phoneHint')}>
            <input value={phone} onInput={(e) => setPhone(e.currentTarget.value)} inputMode="tel" placeholder="+243" />
          </Field>
          <div class="row">
            <button type="button" class="btn" onClick={() => setCreating(false)}>{t('common.back')}</button>
            <button class="btn primary grow">{t('common.save')}</button>
          </div>
        </form>
      ) : (
        <>
          <div class="row">
            <input class="grow" style={{ flex: 1 }} type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('customer.searchPh')} />
            {s.can('customer.edit') && (
              <button class="btn" onClick={() => { setName(q); setCreating(true); }}>
                <Icon.plus />
                {t('common.new')}
              </button>
            )}
          </div>
          <div class="list" style={{ marginTop: 8 }}>
            {list.map((c) => {
              const b = balances.get(c.id)?.balanceUSD ?? 0;
              const over = c.creditLimitUSD != null && b > c.creditLimitUSD;
              return (
                <button class="item" onClick={() => props.onPick(c)}>
                  <div class="main">
                    <div class="title">{c.name}</div>
                    <div class="sub">{c.phone}</div>
                  </div>
                  <div class="end">
                    {b > 0 && <div class={over ? 'neg' : ''}>{t('customer.owes', { amount: fmtUSD(b) })}</div>}
                    {over && <span class="tag bad">{t('customer.overLimit')}</span>}
                  </div>
                </button>
              );
            })}
            {!list.length && <Empty>{t('customer.none')}</Empty>}
          </div>
        </>
      )}
    </Sheet>
  );
}
