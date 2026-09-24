import { useEffect, useMemo, useState } from 'preact/hooks';
import { can } from '../shared/permissions';
import { checkPin } from '../shared/pin';
import type { Customer, Product, Store, User } from '../shared/types';
import type { SyncStatus } from './core/engine';
import { getMeta, setMeta } from './core/db';
import { db, engine, go, SessionContext, setToastHandler, t, toast as showToast, useLive, useRoute, type Session, errText } from './state';
import { Icon, Field, Toasts, type ToastItem } from './ui';
import { SellPage } from './pages/sell';
import { ReceiptPage, SalesPage, VoidPage } from './pages/sales';
import { ProductsPage, ProductPage, ProductEditPage } from './pages/products';
import { StockPage, AdjustPage } from './pages/stock';
import { CustomersPage, CustomerPage, CustomerEditPage } from './pages/customers';
import { ReportsPage } from './pages/reports';
import { MenuPage } from './pages/menu';
import { TransfersPage, TransferNewPage, TransferPage, RequestNewPage } from './pages/transfers';
import { PurchasesPage, PurchaseNewPage, PurchasePage, SuppliersPage, SupplierEditPage } from './pages/purchases';
import { CountsPage, CountNewPage, CountPage } from './pages/counts';
import { CashPage } from './pages/cash';
import { AlertsPage, AuditPage, RatePage, SyncPage, DevicePage, UsersPage, UserEditPage, StoresPage, StoreEditPage, ReversePage } from './pages/admin';

const IDLE_LOCK_MS = 20 * 60_000;

export function App() {
  const [ready, setReady] = useState(false);
  const [hasDevice, setHasDevice] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const closeToast = (id: number) => setToasts((l) => l.filter((x) => x.id !== id));

  useEffect(() => {
    let n = 0;
    setToastHandler((msg, kind) => {
      const id = ++n;
      // newest first, at most 3; errors stay longer so they can be read
      setToasts((l) => [{ id, msg, kind }, ...l.filter((x) => x.msg !== msg)].slice(0, 3));
      setTimeout(() => closeToast(id), kind === 'error' ? 6000 : kind === 'warning' ? 4500 : 3200);
    });
    // any save that fails unexpectedly still tells the user, in red
    const onFail = (e: PromiseRejectionEvent) => {
      const code = (e.reason as Error)?.message;
      showToast(errText(code), 'error');
    };
    window.addEventListener('unhandledrejection', onFail);
    engine.init().then(() => {
      setHasDevice(!!engine.device);
      setReady(true);
      if (engine.device) engine.sync().catch(() => {});
    });
    // Ask the browser not to clear our data when the phone is low on space.
    navigator.storage?.persist?.().catch(() => {});
    const tick = () => engine.device && engine.sync().catch(() => {});
    const id = setInterval(tick, 30_000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
    return () => clearInterval(id);
  }, []);

  if (!ready) return <div class="center">{t('common.loading')}</div>;
  return (
    <>
      {hasDevice ? <Authed /> : <EnrollPage onDone={() => setHasDevice(true)} />}
      <Toasts items={toasts} onClose={closeToast} />
    </>
  );
}

function Authed() {
  const current = useLive(() => getMeta<{ userId: string; at: number } | null>(db, 'session', null), [], undefined as any);
  const users = useLive(() => db.user.toArray() as Promise<User[]>, [], [] as User[]);
  if (current === undefined) return null;
  const user = current && users.find((u) => u.id === current.userId && u.active);
  if (!user) return <PinLogin users={users} />;
  return <Shell user={user} />;
}

// ---------------- device enrollment ----------------

function EnrollPage(props: { onDone: () => void }) {
  const [step, setStep] = useState<'login' | 'store' | 'syncing'>('login');
  const [server, setServer] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState<{ stores: Store[]; allStores: boolean } | null>(null);
  const [storeId, setStoreId] = useState<string>('');
  const [name, setName] = useState('');

  const post = async (path: string, body: object) => {
    const res = await fetch(`${server.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `http_${res.status}`);
    return json;
  };

  const submitLogin = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (!navigator.onLine) return setError(t('enroll.needsInternet'));
    setBusy(true);
    try {
      const o = await post('/api/enroll/options', { username, password });
      setOpts(o);
      setStoreId(o.stores[0]?.id ?? '');
      setStep('store');
    } catch (err) {
      setError(errText((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const submitStore = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await post('/api/enroll', { username, password, storeId: storeId === '*' ? null : storeId, deviceName: name || navigator.userAgent.slice(0, 40) });
      await engine.setDevice({ deviceId: d.deviceId, deviceCode: d.deviceCode, token: d.token, storeId: d.storeId, serverUrl: server.replace(/\/$/, '') });
      setStep('syncing');
      await engine.sync();
      props.onDone();
    } catch (err) {
      setError(errText((err as Error).message));
      setStep('store');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="center">
      <Brand />
      {step === 'login' && (
        <form class="stack" onSubmit={submitLogin}>
          <h1>{t('enroll.title')}</h1>
          <p class="muted">{t('enroll.intro')}</p>
          <Field label={t('enroll.username')}>
            <input value={username} onInput={(e) => setUsername(e.currentTarget.value)} autoComplete="username" autoCapitalize="none" required />
          </Field>
          <Field label={t('enroll.password')}>
            <input type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required />
          </Field>
          {advanced ? (
            <Field label={t('enroll.server')} hint={t('enroll.serverHint')}>
              <input value={server} onInput={(e) => setServer(e.currentTarget.value)} placeholder="https://" inputMode="url" />
            </Field>
          ) : (
            <button type="button" class="btn small" onClick={() => setAdvanced(true)}>{t('enroll.advanced')}</button>
          )}
          {error && <div class="notice bad">{error}</div>}
          <button class="btn primary block" disabled={busy}>{busy ? t('common.wait') : t('common.continue')}</button>
        </form>
      )}
      {step === 'store' && opts && (
        <form class="stack" onSubmit={submitStore}>
          <h1>{t('enroll.whichStore')}</h1>
          <Field label={t('enroll.store')}>
            <select value={storeId} onChange={(e) => setStoreId(e.currentTarget.value)}>
              {opts.stores.map((s) => (
                <option value={s.id}>{s.name}</option>
              ))}
              {opts.allStores && <option value="*">{t('enroll.allStores')}</option>}
            </select>
          </Field>
          <Field label={t('enroll.deviceName')} hint={t('enroll.deviceNameHint')}>
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder={t('enroll.deviceNamePh')} />
          </Field>
          {error && <div class="notice bad">{error}</div>}
          <button class="btn primary block" disabled={busy}>{busy ? t('common.wait') : t('enroll.connect')}</button>
        </form>
      )}
      {step === 'syncing' && (
        <div class="stack">
          <h1>{t('enroll.downloading')}</h1>
          <p class="muted">{t('enroll.downloadingHint')}</p>
        </div>
      )}
    </div>
  );
}

function Brand() {
  return (
    <div class="brand">
      <div class="mark">ID</div>
      <div>
        <h1>Inter-Diesel</h1>
        <div class="muted">{t('app.tagline')}</div>
      </div>
    </div>
  );
}

// ---------------- PIN login ----------------

function PinLogin(props: { users: User[] }) {
  const dev = engine.device!;
  const users = props.users
    .filter((u) => u.active && (u.role === 'owner' || !dev.storeId || u.storeId === dev.storeId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stores = useLive(() => db.store.toArray() as Promise<Store[]>, [], [] as Store[]);
  const [who, setWho] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);

  const press = async (k: string) => {
    setError('');
    if (k === 'del') return setPin(pin.slice(0, -1));
    const next = (pin + k).slice(0, 6);
    setPin(next);
    if (next.length >= 4 && who) {
      if (await checkPin(next, who.id, who.pinHash)) {
        await setMeta(db, 'session', { userId: who.id, at: Date.now() });
        go('/');
      } else if (next.length === 6) {
        // PINs can be 4 to 6 digits: report an error only at 6 digits or when OK is pressed
        setTries(tries + 1);
        setPin('');
        setError(t('login.wrongPin'));
      }
    }
  };
  const submit = async () => {
    if (!who) return;
    if (await checkPin(pin, who.id, who.pinHash)) {
      await setMeta(db, 'session', { userId: who.id, at: Date.now() });
      go('/');
    } else {
      setTries(tries + 1);
      setPin('');
      setError(t('login.wrongPin'));
    }
  };

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name ?? '' : t('role.allStores'));
  if (!users.length) {
    return (
      <div class="center stack">
        <Brand />
        <p>{t('login.noUsers')}</p>
        <button class="btn" onClick={() => engine.sync().catch(() => {})}>{t('sync.now')}</button>
      </div>
    );
  }
  return (
    <div class="center">
      <Brand />
      {!who ? (
        <div class="stack">
          <h1>{t('login.who')}</h1>
          <div class="users">
            {users.map((u) => (
              <button onClick={() => setWho(u)}>
                {u.name}
                <span>
                  {t(`role.${u.role}`)} · {storeName(u.storeId)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div class="stack">
          <h1>{t('login.pinFor', { name: who.name })}</h1>
          <div class="pin-dots" aria-label={t('login.pin')}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <i class={i < pin.length ? 'on' : ''} />
            ))}
          </div>
          {error && <div class="notice bad">{error}</div>}
          <div class="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
              <button onClick={() => press(k)}>{k}</button>
            ))}
            <button class="fn" onClick={() => press('del')}>{t('login.erase')}</button>
            <button onClick={() => press('0')}>0</button>
            <button class="fn" onClick={submit} disabled={pin.length < 4}>{t('common.ok')}</button>
          </div>
          <button class="btn block" onClick={() => { setWho(null); setPin(''); setError(''); }}>
            {t('login.otherUser')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- main shell ----------------

function Shell(props: { user: User }) {
  const { user } = props;
  const dev = engine.device!;
  const stores = useLive(() => db.store.toArray() as Promise<Store[]>, [], [] as Store[]);
  const users = useLive(() => db.user.toArray() as Promise<User[]>, [], [] as User[]);
  const products = useLive(() => db.product.toArray() as Promise<Product[]>, [], [] as Product[]);
  const customers = useLive(() => db.customer.toArray() as Promise<Customer[]>, [], [] as Customer[]);
  const rate = useLive(async () => (await db.rate.orderBy('at').last())?.cdfPerUsd ?? 2300, [], 2300);
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem('workStore');
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<SyncStatus>(engine.status);
  useEffect(() => engine.onStatus(setStatus), []);

  // lock after inactivity so a phone left on the counter is not used under someone else's name
  useEffect(() => {
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ['pointerdown', 'keydown'];
    events.forEach((e) => window.addEventListener(e, bump));
    const id = setInterval(() => {
      if (Date.now() - last > IDLE_LOCK_MS) setMeta(db, 'session', null);
    }, 30_000);
    return () => {
      clearInterval(id);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, []);

  const allStores = !dev.storeId && user.role === 'owner';
  const activeStores = stores.filter((s) => s.active);
  const storeId = dev.storeId ?? (user.role !== 'owner' ? user.storeId : null) ?? (picked && activeStores.some((s) => s.id === picked) ? picked : activeStores[0]?.id) ?? '';
  const store = stores.find((s) => s.id === storeId);

  const session: Session | null = useMemo(
    () =>
      store
        ? {
            user,
            storeId,
            store,
            stores: activeStores,
            users,
            products,
            productById: new Map(products.map((p) => [p.id, p])),
            customers,
            rate,
            allStores,
            // on a store device the owner works as a manager of that store (see ARCHITECTURE.md)
            can: (a) => can(dev.storeId && user.role === 'owner' ? 'manager' : user.role, a),
            setStore: (id) => {
              try {
                localStorage.setItem('workStore', id);
              } catch {}
              setPicked(id);
            },
            logout: () => setMeta(db, 'session', null),
          }
        : null,
    [user, storeId, store, stores, users, products, customers, rate, allStores],
  );

  if (!session) return <div class="center">{t('common.loading')}</div>;
  return (
    <SessionContext.Provider value={session}>
      <div class="shell">
        <header class="topbar">
          <div class="who">
            <b>{user.name}</b>
            {allStores ? (
              <select value={storeId} onChange={(e) => session.setStore(e.currentTarget.value)} aria-label={t('common.store')}>
                {activeStores.map((s) => (
                  <option value={s.id}>{s.name.replace(/^Inter-Diesel\s+/i, '') || s.name}</option>
                ))}
              </select>
            ) : (
              <span>{store!.name}</span>
            )}
          </div>
          <SyncBadge status={status} />
          <button class="tb-btn" onClick={session.logout} aria-label={t('login.switch')}>
            {t('login.switchShort')}
          </button>
        </header>
        {status.state === 'offline' && <div class="offline-bar">{t('sync.offlineBar', { n: status.pending })}</div>}
        {status.state === 'revoked' && <div class="offline-bar" style={{ background: 'var(--bad)' }}>{t('sync.revoked')}</div>}
        <main>
          <Router />
        </main>
        <Nav />
      </div>
    </SessionContext.Provider>
  );
}

function SyncBadge(props: { status: SyncStatus }) {
  const s = props.status;
  let cls = 'ok';
  let label = t('sync.synced');
  if (s.state === 'offline') {
    cls = 'offline';
    label = s.pending ? t('sync.offlinePending', { n: s.pending }) : t('sync.offline');
  } else if (s.state === 'error' || s.state === 'revoked' || s.rejected) {
    cls = 'error';
    label = s.rejected ? t('sync.rejectedShort', { n: s.rejected }) : t('sync.error');
  } else if (s.state === 'syncing') {
    cls = 'pending';
    label = t('sync.syncing');
  } else if (s.pending) {
    cls = 'pending';
    label = t('sync.pending', { n: s.pending });
  }
  return (
    <button class={`sync ${cls}`} onClick={() => go('/sync')} aria-label={label}>
      <span class="dot" />
      {label}
    </button>
  );
}

function Nav() {
  const { path, query } = useRoute();
  // the tab lit up matches the first link of the page's breadcrumb trail
  const top = path[0] === 'sale' && query.get('new') === '1' ? '' : path[0] ?? '';
  const items = [
    { href: '/', match: [''], label: t('nav.sell'), icon: Icon.cart },
    { href: '/products', match: ['products', 'product', 'stock', 'adjust'], label: t('nav.products'), icon: Icon.box },
    { href: '/customers', match: ['customers', 'customer'], label: t('nav.customers'), icon: Icon.people },
    { href: '/reports', match: ['reports', 'cash', 'sales', 'sale'], label: t('nav.reports'), icon: Icon.chart },
    { href: '/menu', match: ['menu'], label: t('nav.menu'), icon: Icon.menu },
  ];
  const matched = items.find((i) => i.match.includes(top));
  return (
    <nav class="nav" aria-label={t('nav.label')}>
      {items.map((i) => {
        const on = matched ? i === matched : i.href === '/menu';
        return (
          <a href={`#${i.href}`} class={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
            <i.icon />
            {i.label}
          </a>
        );
      })}
    </nav>
  );
}

function Router() {
  const { path, query } = useRoute();
  const [a, b, c] = path;
  switch (a) {
    case undefined:
    case '':
      return <SellPage />;
    case 'sale':
      return c === 'void' ? <VoidPage id={b} /> : <ReceiptPage id={b} fresh={query.get('new') === '1'} />;
    case 'sales':
      return <SalesPage />;
    case 'products':
      return <ProductsPage />;
    case 'product':
      return b === 'new' ? <ProductEditPage /> : c === 'edit' ? <ProductEditPage id={b} /> : <ProductPage id={b} />;
    case 'stock':
      return <StockPage />;
    case 'adjust':
      return <AdjustPage productId={query.get('product') ?? ''} />;
    case 'customers':
      return <CustomersPage />;
    case 'customer':
      return b === 'new' ? <CustomerEditPage /> : c === 'edit' ? <CustomerEditPage id={b} /> : <CustomerPage id={b} />;
    case 'reports':
      return <ReportsPage />;
    case 'cash':
      return <CashPage />;
    case 'menu':
      return <MenuPage />;
    case 'transfers':
      return <TransfersPage />;
    case 'transfer':
      return b === 'new' ? <TransferNewPage requestId={query.get('request')} /> : b === 'request' ? <RequestNewPage productId={query.get('product')} /> : <TransferPage id={b} />;
    case 'purchases':
      return <PurchasesPage />;
    case 'purchase':
      return b === 'new' ? <PurchaseNewPage /> : <PurchasePage id={b} />;
    case 'suppliers':
      return <SuppliersPage />;
    case 'supplier':
      return <SupplierEditPage id={b === 'new' ? undefined : b} />;
    case 'counts':
      return <CountsPage />;
    case 'count':
      return b === 'new' ? <CountNewPage /> : <CountPage id={b} />;
    case 'alerts':
      return <AlertsPage />;
    case 'audit':
      return <AuditPage />;
    case 'rate':
      return <RatePage />;
    case 'sync':
      return <SyncPage />;
    case 'device':
      return <DevicePage />;
    case 'users':
      return <UsersPage />;
    case 'user':
      return <UserEditPage id={b === 'new' ? undefined : b} />;
    case 'stores':
      return <StoresPage />;
    case 'reverse':
      return <ReversePage kind={b} id={c} />;
    case 'store':
      return <StoreEditPage id={b} />;
    default:
      return <SellPage />;
  }
}
