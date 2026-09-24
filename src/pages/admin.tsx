import { useEffect, useState } from 'preact/hooks';
import { ulid } from 'ulid';
import { back, db, engine, go, notifySave, t, toast, useLive, useSession, errText } from '../state';
import { inverseOf, receiveIdFor, reversalIdFor } from '../../shared/derive';
import { fmtUSD } from '../../shared/money';
import { Empty, Field, Icon, Page, Section } from '../ui';
import { hashPin, validPin } from '../../shared/pin';
import { fmtDateTime } from '../../shared/time';
import { fmtCDF, usdToCdf } from '../../shared/money';
import type { Alert, AuditEntry, RateDoc, Reversal, ReversibleKind, Role, Store, User } from '../../shared/types';
import { REVERSIBLE_KINDS } from '../../shared/types';
import type { OutboxItem } from '../core/db';
import type { SyncStatus } from '../core/engine';

// ---------------- alerts ----------------
export function AlertsPage() {
  const s = useSession();
  const [showAll, setShowAll] = useState(false);
  const alerts = useLive(
    () => db.alert.toArray().then((a: Alert[]) => a.filter((x) => (s.allStores || !x.storeId || x.storeId === s.storeId) && (showAll || !x.resolved)).sort((a, b) => b.at - a.at)),
    [s.storeId, showAll],
    [] as Alert[],
  );
  const resolve = async (a: Alert) => {
    await engine.patch('alert', a.id, s.user.id, { resolved: true, resolvedBy: s.user.id, resolvedAt: engine.now() });
    toast(t('toast.alertResolved'), 'info');
  };
  const describe = (a: Alert) => {
    const p = a.productId ? s.productById.get(a.productId)?.name ?? a.productId : '';
    const store = s.stores.find((x) => x.id === a.storeId)?.name ?? '';
    return t(`alert.${a.type}`, { product: p, qty: a.qty ?? '', store, message: a.message ?? '' });
  };
  const link = (a: Alert) =>
    a.type === 'negative_stock' && a.productId ? `#/product/${a.productId}` : a.type === 'transfer_gap' && a.ref ? `#/transfer/${a.ref}` : a.type === 'count_gap' && a.ref ? `#/count/${a.ref}` : a.type === 'inactive_user' && a.ref ? `#/sale/${a.ref}` : a.type === 'rejected_op' ? '#/sync' : undefined;
  return (
    <Page title={t('alerts.title')} back="/menu">
      <label class="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} />{t('alerts.showResolved')}</label>
      <div class="list">
        {alerts.map((a) => (
          <div class="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
            <div class="main">
              <div class="title">{describe(a)}</div>
              <div class="sub">{fmtDateTime(a.at)} · {s.stores.find((x) => x.id === a.storeId)?.name ?? t('reports.allStores')}</div>
              {link(a) && <a class="btn small" style={{ marginTop: 6 }} href={link(a)}>{t('alerts.see')}</a>}
            </div>
            {a.resolved ? (
              <span class="tag ok">{t('alerts.resolved')}</span>
            ) : (
              s.can('alert.resolve') && (
                <button class="btn small" onClick={() => resolve(a)}><Icon.check />{t('alerts.resolve')}</button>
              )
            )}
          </div>
        ))}
        {!alerts.length && <Empty>{t('alerts.none')}</Empty>}
      </div>
    </Page>
  );
}

// ---------------- audit ----------------
export function AuditPage() {
  const s = useSession();
  const [limit, setLimit] = useState(100);
  const rows = useLive(
    () => db.audit.orderBy('at').reverse().filter((a: AuditEntry) => s.allStores || !a.storeId || a.storeId === s.storeId).limit(limit).toArray(),
    [s.storeId, limit],
    [] as AuditEntry[],
  );
  const users = new Map(s.users.map((u) => [u.id, u.name]));
  // show names instead of internal ids (st_…, p_…, u_…) so the journal reads like plain French
  const storeName = (id: string) => s.stores.find((x) => x.id === id)?.name ?? id;
  const val = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'pinHash') return '••••';
    if (typeof v === 'boolean') return k === 'active' ? t(v ? 'common.active' : 'common.inactive') : t(v ? 'common.yes' : 'common.no');
    if (typeof v === 'string') {
      if (/storeid$/i.test(k)) return storeName(v);
      if (k === 'productId') return s.productById.get(v)?.name ?? v;
      if (k === 'customerId') return s.customers.find((c) => c.id === v)?.name ?? v;
      if (k === 'userId' || k === 'resolvedBy') return users.get(v) ?? v;
    }
    if (typeof v === 'number' && /At$/.test(k) && v > 1e12) return fmtDateTime(v);
    return typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v);
  };
  const summary = (x: string) => {
    const m = /^(st_[\w-]+):(p_[\w-]+)$/.exec(x ?? '');
    return m ? `${s.productById.get(m[2])?.name ?? m[2]} (${storeName(m[1]).replace(/^Inter-Diesel\s+/i, '')})` : x;
  };
  if (!s.can('audit.view')) return <Page title={t('audit.title')} back><Empty>{t('error.forbidden')}</Empty></Page>;
  return (
    <Page title={t('audit.title')} back="/menu">
      <p class="muted">{t('audit.explain')}</p>
      <div class="list">
        {rows.map((a) => (
          <div class="item" style={{ cursor: 'default' }}>
            <div class="main">
              <div class="title">{t(`audit.${a.kind}`) === `audit.${a.kind}` ? a.kind : t(`audit.${a.kind}`)} · {summary(a.summary)}</div>
              <div class="sub">{fmtDateTime(a.at)} · {users.get(a.userId) ?? a.userId} · {s.stores.find((x) => x.id === a.storeId)?.name ?? ''}</div>
              {a.changes &&
                Object.entries(a.changes)
                  .filter(([k]) => k !== 'fits' && !(a.kind === 'minstock' && (k === 'storeId' || k === 'productId')))
                  .slice(0, 4)
                  .map(([k, pair]) => {
                    const [b, c] = pair as [unknown, unknown];
                    return (
                      <div class="sub">
                        {t(`field.${k}`) === `field.${k}` ? k : t(`field.${k}`)} : {val(k, b)} → <b>{val(k, c)}</b>
                      </div>
                    );
                  })}
            </div>
          </div>
        ))}
        {!rows.length && <Empty>{t('audit.none')}</Empty>}
      </div>
      {rows.length >= limit && <button class="btn block" onClick={() => setLimit(limit + 200)}>{t('common.more')}</button>}
    </Page>
  );
}

// ---------------- exchange rate ----------------
export function RatePage() {
  const s = useSession();
  const history = useLive(() => db.rate.orderBy('at').reverse().limit(30).toArray() as Promise<RateDoc[]>, [], [] as RateDoc[]);
  const [v, setV] = useState('');
  const n = Math.round(Number(v.replace(/\s/g, '').replace(',', '.')) || 0);
  const save = async (e: Event) => {
    e.preventDefault();
    if (n < 100) return;
    await engine.createDoc<RateDoc>('rate', s.user.id, s.storeId, { cdfPerUsd: n });
    setV('');
    toast(t('rate.saved', { rate: n }), 'success');
  };
  return (
    <Page title={t('rate.title')} back="/menu">
      <div class="headline">
        <div class="label">{t('rate.current')}</div>
        <div class="big">1 $ = {fmtCDF(s.rate)}</div>
      </div>
      {s.can('rate.set') ? (
        <form class="stack" onSubmit={save}>
          <Field label={t('rate.new')} hint={t('rate.hint')}>
            <input inputMode="numeric" value={v} onInput={(e) => setV(e.currentTarget.value)} placeholder={String(s.rate)} />
          </Field>
          {n >= 100 && Math.abs(n - s.rate) / s.rate > 0.1 && <div class="notice warn">{t('rate.bigChange')}</div>}
          {n >= 100 && <p class="muted">{t('rate.example', { cdf: fmtCDF(usdToCdf(10, n)) })}</p>}
          <button class="btn primary block" disabled={n < 100}>{t('rate.save')}</button>
        </form>
      ) : (
        <p class="muted">{t('rate.onlyManagers')}</p>
      )}
      <Section title={t('rate.history')} />
      <table class="facts">
        <tbody>
          {history.map((r) => (
            <tr><td>{fmtDateTime(r.at)} · {s.users.find((u) => u.id === r.userId)?.name}</td><td class="n">{fmtCDF(r.cdfPerUsd)}</td></tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}

// ---------------- sync ----------------
export function SyncPage() {
  const s = useSession();
  const [status, setStatus] = useState<SyncStatus>(engine.status);
  useEffect(() => engine.onStatus(setStatus), []);
  const items = useLive(() => db.outbox.toArray(), [], [] as OutboxItem[]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setStorage({ usage: est?.usage, quota: est?.quota, persisted });
    })().catch(() => {});
  }, []);
  const rejected = items.filter((i) => i.status === 'rejected');
  const pending = items.filter((i) => i.status === 'pending');
  const oldest = pending[0]?.createdAt;
  const now = async () => {
    try {
      await engine.sync();
      toast(t('sync.done'), 'success');
    } catch {
      toast(navigator.onLine ? t('sync.failed') : t('sync.offline'), 'error');
    }
  };
  const mb = (n?: number) => (n ? `${(n / 1024 / 1024).toFixed(1)} Mo` : '—');
  return (
    <Page title={t('sync.title')} back="/menu">
      <table class="facts">
        <tbody>
          <tr><th>{t('sync.state')}</th><td class="n"><b>{t(`sync.state.${status.state}`)}</b></td></tr>
          <tr><th>{t('sync.pendingLabel')}</th><td class="n">{status.pending}</td></tr>
          {oldest && <tr><th>{t('sync.oldest')}</th><td class="n">{fmtDateTime(oldest)}</td></tr>}
          <tr><th>{t('sync.last')}</th><td class="n">{status.lastSyncAt ? fmtDateTime(status.lastSyncAt) : '—'}</td></tr>
          <tr><th>{t('sync.storage')}</th><td class="n">{mb(storage.usage)} / {mb(storage.quota)}</td></tr>
          <tr><th>{t('sync.protected')}</th><td class="n">{storage.persisted ? t('common.yes') : t('common.no')}</td></tr>
        </tbody>
      </table>
      {status.error && <div class="notice bad" style={{ marginTop: 8 }}>{errText(status.error)}</div>}
      <p class="muted">{t('sync.explain')}</p>
      <button class="btn primary block" onClick={now} disabled={status.state === 'syncing'}>
        <Icon.sync />
        {status.state === 'syncing' ? t('sync.syncing') : t('sync.now')}
      </button>
      {rejected.length > 0 && (
        <>
          <Section title={t('sync.rejectedTitle', { n: rejected.length })} />
          <p class="muted">{t('sync.rejectedExplain')}</p>
          <div class="list">
            {rejected.map((i) => (
              <div class="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div class="main">
                  <div class="title">{t(`kind.${i.op.kind}`)} · {fmtDateTime(i.createdAt)}</div>
                  <div class="sub">{errText(i.error)} ({i.error})</div>
                </div>
                <div class="row">
                  <button class="btn small" onClick={() => engine.retry(i.seq!)}>{t('sync.retry')}</button>
                  {s.can('sale.void') && <button class="btn small danger" onClick={() => engine.discard(i.seq!)}>{t('sync.discard')}</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {pending.length > 0 && (
        <>
          <Section title={t('sync.pendingTitle')} />
          <div class="list">
            {pending.slice(0, 50).map((i) => (
              <div class="item" style={{ cursor: 'default', minHeight: 48 }}>
                <div class="main">
                  <div>{t(`kind.${i.op.kind}`)}</div>
                  <div class="sub">{fmtDateTime(i.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

// ---------------- device ----------------
export function DevicePage() {
  const s = useSession();
  const d = engine.device!;
  const [pw, setPw] = useState('');
  const [devices, setDevices] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const username = useLive(async () => (s.users.find((u) => u.id === s.user.id) as any)?.username, [s.user.id], undefined);
  const [user, setUser] = useState('');
  const owner = s.user.role === 'owner';

  const post = async (path: string, body: object) => {
    const res = await fetch(`${d.serverUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user || username, password: pw, ...body }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `http_${res.status}`);
    return res;
  };
  const listDevices = async () => {
    setErr('');
    try {
      setDevices(await (await post('/api/admin/devices', {})).json());
    } catch (e) {
      setErr(errText((e as Error).message));
    }
  };
  const revoke = async (id: string) => {
    await post('/api/admin/devices/revoke', { deviceId: id });
    listDevices();
  };
  const backup = async () => {
    setErr('');
    try {
      const blob = await (await post('/api/admin/backup', {})).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `interdiesel-${new Date().toISOString().slice(0, 10)}.sqlite`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(errText((e as Error).message));
    }
  };
  const disconnect = async () => {
    await db.delete();
    try {
      localStorage.clear();
    } catch {}
    location.hash = '';
    location.reload();
  };

  return (
    <Page title={t('device.title')} back="/menu">
      <table class="facts">
        <tbody>
          <tr><th>{t('device.code')}</th><td class="n wrap">{d.deviceCode}</td></tr>
          <tr><th>{t('device.store')}</th><td class="n wrap">{d.storeId ? s.stores.find((x) => x.id === d.storeId)?.name : t('enroll.allStores')}</td></tr>
          <tr><th>{t('device.server')}</th><td class="n wrap">{d.serverUrl || location.origin}</td></tr>
          <tr><th>{t('device.version')}</th><td class="n wrap">{__APP_VERSION__}</td></tr>
        </tbody>
      </table>

      {owner && (
        <>
          <Section title={t('device.ownerTools')} />
          <p class="muted">{t('device.ownerToolsHint')}</p>
          <div class="stack">
            <Field label={t('enroll.username')}>
              <input value={user || username || ''} onInput={(e) => setUser(e.currentTarget.value)} autoCapitalize="none" />
            </Field>
            <Field label={t('enroll.password')}>
              <input type="password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} autoComplete="current-password" />
            </Field>
            {err && <div class="notice bad">{err}</div>}
            <div class="grid2">
              <button class="btn" onClick={backup} disabled={!pw}>{t('device.backup')}</button>
              <button class="btn" onClick={listDevices} disabled={!pw}>{t('device.list')}</button>
            </div>
            {devices && (
              <div class="list">
                {devices.map((x) => (
                  <div class="item" style={{ cursor: 'default' }}>
                    <div class="main">
                      <div class="title">{x.code} · {x.name}</div>
                      <div class="sub">{x.scope ? s.stores.find((st) => st.id === x.scope)?.name : t('enroll.allStores')} · {x.last_seen ? fmtDateTime(x.last_seen) : '—'}</div>
                    </div>
                    {x.revoked ? <span class="tag bad">{t('device.revoked')}</span> : x.id !== d.deviceId && <button class="btn small danger" onClick={() => revoke(x.id)}>{t('device.revoke')}</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <Section title={t('device.disconnect')} />
      {engine.status.pending > 0 ? (
        <div class="notice bad">{t('device.pendingBlock', { n: engine.status.pending })}</div>
      ) : (
        <div class="stack">
          <p class="muted">{t('device.disconnectHint')}</p>
          <Field label={t('device.typeToConfirm')}>
            <input value={confirmText} onInput={(e) => setConfirmText(e.currentTarget.value)} autoCapitalize="characters" />
          </Field>
          <button class="btn danger solid block" disabled={confirmText.trim().toUpperCase() !== t('device.confirmWord')} onClick={disconnect}>
            {t('device.disconnect')}
          </button>
        </div>
      )}
    </Page>
  );
}

// ---------------- users ----------------
export function UsersPage() {
  const s = useSession();
  if (!s.can('user.manage')) return <Page title={t('users.title')} back><Empty>{t('error.forbidden')}</Empty></Page>;
  const byStore = (id: string | null) => s.users.filter((u) => u.storeId === id).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  return (
    <Page title={t('users.title')} back="/menu" actions={<a class="btn small dark" href="#/user/new"><Icon.plus />{t('common.new')}</a>}>
      {[null, ...s.stores.map((x) => x.id)].map((sid) => {
        const list = byStore(sid);
        if (!list.length) return null;
        return (
          <>
            <h2 style={{ margin: '16px 0 6px' }}>{sid ? s.stores.find((x) => x.id === sid)?.name : t('role.allStores')}</h2>
            <div class="list">
              {list.map((u) => (
                <a class="item" href={`#/user/${u.id}`}>
                  <div class="main">
                    <div class="title">{u.name}{!u.active && <span class="tag" style={{ marginLeft: 6 }}>{t('common.inactive')}</span>}</div>
                    <div class="sub">{[t(`role.${u.role}`), u.phone].filter(Boolean).join(" · ")}{!u.active && <> <span class="tag bad">{t("common.inactive")}</span></>}</div>
                  </div>
                </a>
              ))}
            </div>
          </>
        );
      })}
    </Page>
  );
}

export function UserEditPage(props: { id?: string }) {
  const s = useSession();
  const existing = props.id ? s.users.find((u) => u.id === props.id) : undefined;
  const [f, setF] = useState<Partial<User>>({});
  const v: Omit<User, 'id'> = { name: '', role: 'seller', storeId: s.storeId, pinHash: '', phone: '', active: true, ...(existing ?? {}), ...f };
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [login, setLogin] = useState({ newUsername: '', newPassword: '', ownerPassword: '' });
  const [msg, setMsg] = useState('');
  const set = (p: Partial<User>) => setF({ ...f, ...p });
  if (!s.can('user.manage')) return <Page title={t('users.title')} back><Empty>{t('error.forbidden')}</Empty></Page>;
  const needsPin = !existing;
  const pinOk = (!pin && !needsPin) || (validPin(pin) && pin === pin2);

  const save = async (e: Event) => {
    e.preventDefault();
    if (!v.name.trim() || !pinOk) return;
    const id = props.id ?? `u_${ulid()}`;
    const fields: Record<string, unknown> = existing ? { ...f } : { ...v, name: v.name.trim() };
    delete fields.username;
    if (fields.role === 'owner') fields.storeId = null;
    if (pin) fields.pinHash = await hashPin(pin, id);
    if (Object.keys(fields).length) await engine.patch('user', id, s.user.id, fields);
    notifySave(v.name.trim(), existing, fields);
    go('/users');
  };
  const setCredentials = async (e: Event) => {
    e.preventDefault();
    setMsg('');
    const owner = s.users.find((u) => u.id === s.user.id) as any;
    try {
      const res = await fetch(`${engine.device!.serverUrl}/api/admin/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: owner?.username ?? '', password: login.ownerPassword, userId: props.id, newUsername: login.newUsername, newPassword: login.newPassword }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'network');
      setMsg(t('users.loginSaved'));
      toast(t('users.loginSaved'), 'success');
      setLogin({ newUsername: '', newPassword: '', ownerPassword: '' });
    } catch (err) {
      setMsg(errText((err as Error).message));
      toast(errText((err as Error).message), 'error');
    }
  };

  return (
    <Page title={existing ? existing.name : t('users.new')} back>
      <form class="stack" onSubmit={save}>
        <Field label={t('customer.name')}><input value={v.name} onInput={(e) => set({ name: e.currentTarget.value })} required /></Field>
        <Field label={t('users.role')}>
          <select value={v.role} onChange={(e) => set({ role: e.currentTarget.value as Role })} disabled={existing?.id === s.user.id}>
            <option value="seller">{t('role.seller')}</option>
            <option value="manager">{t('role.manager')}</option>
            <option value="owner">{t('role.owner')}</option>
          </select>
        </Field>
        {v.role !== 'owner' && (
          <Field label={t('common.store')}>
            <select value={v.storeId ?? ''} onChange={(e) => set({ storeId: e.currentTarget.value })}>
              {s.stores.map((x) => (
                <option value={x.id}>{x.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('customer.phone')} hint={t('users.phoneHint')}><input value={v.phone} onInput={(e) => set({ phone: e.currentTarget.value })} inputMode="tel" /></Field>
        <div class="grid2">
          <Field label={existing ? t('users.newPin') : t('users.pin')}><input type="password" inputMode="numeric" value={pin} onInput={(e) => setPin(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} /></Field>
          <Field label={t('users.pin2')}><input type="password" inputMode="numeric" value={pin2} onInput={(e) => setPin2(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} /></Field>
        </div>
        {pin && !pinOk && <div class="notice warn">{t('users.pinRule')}</div>}
        {existing && existing.id !== s.user.id && (
          <label class="check"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.currentTarget.checked })} />{t('users.active')}</label>
        )}
        <button class="btn primary block" disabled={!pinOk || !v.name.trim()}>{t('common.save')}</button>
      </form>
      {existing && existing.role !== 'seller' && (
        <>
          <Section title={t('users.login')} />
          <p class="muted">{t('users.loginHint')}</p>
          <form class="stack" onSubmit={setCredentials}>
            <Field label={t('enroll.username')}><input value={login.newUsername} onInput={(e) => setLogin({ ...login, newUsername: e.currentTarget.value })} autoCapitalize="none" required minLength={3} /></Field>
            <Field label={t('users.newPassword')}><input type="password" value={login.newPassword} onInput={(e) => setLogin({ ...login, newPassword: e.currentTarget.value })} required minLength={8} autoComplete="new-password" /></Field>
            <Field label={t('users.ownerPassword')}><input type="password" value={login.ownerPassword} onInput={(e) => setLogin({ ...login, ownerPassword: e.currentTarget.value })} required /></Field>
            {msg && <div class="notice">{msg}</div>}
            <button class="btn block">{t('users.saveLogin')}</button>
          </form>
        </>
      )}
    </Page>
  );
}

// ---------------- stores ----------------
export function StoresPage() {
  const s = useSession();
  const all = useLive(() => db.store.toArray() as Promise<Store[]>, [], [] as Store[]);
  return (
    <Page title={t('stores.title')} back="/menu">
      <div class="list">
        {all.map((x) => (
          <a class="item" href={`#/store/${x.id}`}>
            <div class="main">
              <div class="title">{x.name} ({x.code})</div>
              <div class="sub">{x.address} · {x.phone}</div>
            </div>
          </a>
        ))}
      </div>
      {s.can('store.manage') && <a class="btn block" style={{ marginTop: 12 }} href={`#/store/st_${ulid().slice(-8).toLowerCase()}`}><Icon.plus />{t('stores.new')}</a>}
    </Page>
  );
}

export function StoreEditPage(props: { id: string }) {
  const s = useSession();
  const existing = useLive(() => db.store.get(props.id) as Promise<Store | undefined>, [props.id], undefined);
  const [f, setF] = useState<Partial<Store>>({});
  const v: Omit<Store, 'id'> = { name: '', code: '', address: '', phone: '', active: true, ...(existing ?? {}), ...f };
  const set = (p: Partial<Store>) => setF({ ...f, ...p });
  const save = async (e: Event) => {
    e.preventDefault();
    const fields = existing ? f : { ...v, code: v.code.toUpperCase() };
    if (fields.code) fields.code = fields.code.toUpperCase();
    if (Object.keys(fields).length) await engine.patch('store', props.id, s.user.id, fields as Record<string, unknown>);
    notifySave(v.name, existing, fields as Record<string, unknown>);
    go('/stores');
  };
  return (
    <Page title={existing ? existing.name : t('stores.new')} back>
      <form class="stack" onSubmit={save}>
        <Field label={t('customer.name')}><input value={v.name} onInput={(e) => set({ name: e.currentTarget.value })} required /></Field>
        <Field label={t('stores.code')} hint={t('stores.codeHint')}><input value={v.code} maxLength={6} onInput={(e) => set({ code: e.currentTarget.value })} required /></Field>
        <Field label={t('stores.address')}><input value={v.address} onInput={(e) => set({ address: e.currentTarget.value })} /></Field>
        <Field label={t('stores.phone')} hint={t('stores.phoneHint')}><input value={v.phone} onInput={(e) => set({ phone: e.currentTarget.value })} inputMode="tel" /></Field>
        {existing && <label class="check"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.currentTarget.checked })} />{t('common.active')}</label>}
        <button class="btn primary block" disabled={!s.can('store.manage')}>{t('common.save')}</button>
      </form>
    </Page>
  );
}

// ---------------- reversals (owner cancels any operation) ----------------

/** Ids of cancelled documents, for lists that must hide or mark them. */
export function useReversedIds(): Set<string> {
  const rows = useLive(() => db.reversal.toArray(), [], [] as any[]);
  return new Set(rows.map((r: any) => r.refId as string));
}

/** "Cancelled" tag, or an "Annuler" button for the owner. */
export function ReverseControl(props: { kind: ReversibleKind; id: string; block?: boolean }) {
  const s = useSession();
  const rev = useLive(() => db.reversal.get(reversalIdFor(props.id)), [props.id], undefined as any);
  if (rev) return <div class="notice bad" style={{ marginTop: 10 }}>{t('reverse.done', { reason: rev.reason, at: fmtDateTime(rev.at) })}</div>;
  if (!s.can('doc.reverse')) return null;
  return (
    <a class={`btn danger ${props.block ? 'block' : 'small'}`} style={props.block ? { marginTop: 14 } : undefined} href={`#/reverse/${props.kind}/${props.id}`}>
      {t('reverse.action')}
    </a>
  );
}

export function ReversePage(props: { kind: string; id: string }) {
  const s = useSession();
  const kind = props.kind as ReversibleKind;
  const doc = useLive(() => (REVERSIBLE_KINDS.includes(kind) ? db.table(kind).get(props.id) : Promise.resolve(undefined)), [kind, props.id], undefined as any);
  const received = useLive(
    () => (kind === 'transfer_send' ? db.transfer_receive.get(receiveIdFor(props.id)) : Promise.resolve(undefined)),
    [kind, props.id],
    undefined as any,
  );
  const recvReversed = useLive(() => (received ? db.reversal.get(reversalIdFor(received.id)) : Promise.resolve(undefined)), [received?.id], undefined as any);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!s.can('doc.reverse')) return <Page title={t('reverse.title')} back><Empty>{t('error.forbidden')}</Empty></Page>;
  if (!doc) return <Page title={t('reverse.title')} back><Empty>{t('common.notFound')}</Empty></Page>;
  const inv = inverseOf(kind, doc);
  // A received transfer is cancelled as a whole: first the reception, then the sending.
  const alsoReception = kind === 'transfer_send' && received && !recvReversed ? received : null;
  const recvInv = alsoReception ? inverseOf('transfer_receive', alsoReception) : null;
  if (recvInv) inv.movements.unshift(...recvInv.movements);
  const blocked = false;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (reason.trim().length < 2 || blocked) return;
    setBusy(true);
    try {
      if (alsoReception && recvInv) {
        await engine.createDoc<Reversal>('reversal', s.user.id, alsoReception.storeId, {
          id: reversalIdFor(alsoReception.id),
          refKind: 'transfer_receive',
          refId: alsoReception.id,
          reason: reason.trim(),
          ...recvInv,
        });
      }
      const own = inverseOf(kind, doc);
      await engine.createDoc<Reversal>('reversal', s.user.id, doc.storeId, { id: reversalIdFor(doc.id), refKind: kind, refId: doc.id, reason: reason.trim(), ...own });
      toast(t('reverse.saved'), 'warning');
      back();
    } catch {
      toast(t('error.generic'), 'error');
      setBusy(false);
    }
  };

  return (
    <Page title={t('reverse.title')} back>
      <p>
        <b>{t(`kind.${kind}`)}</b> · {fmtDateTime(doc.at)} · {s.users.find((u) => u.id === doc.userId)?.name} · {s.stores.find((x) => x.id === doc.storeId)?.name}
      </p>
      <div class="notice warn">{t('reverse.explain')}</div>
      {inv.movements.length > 0 && (
        <>
          <Section title={t('reverse.stockEffect')} />
          <table class="facts">
            <tbody>
              {inv.movements.map((m) => (
                <tr>
                  <td>{s.productById.get(m.productId)?.name ?? m.productId}<div class="muted">{s.stores.find((x) => x.id === m.storeId)?.name}</div></td>
                  <td class={`n ${m.qty < 0 ? 'neg' : 'pos'}`}><b>{m.qty > 0 ? '+' : ''}{m.qty}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {inv.ledger.map((l) => (
        <p>{t('reverse.debtEffect', { name: s.customers.find((c) => c.id === l.customerId)?.name ?? '', amount: fmtUSD(l.amountUSD) })}</p>
      ))}
      {alsoReception && <div class="notice" style={{ marginTop: 10 }}>{t('reverse.withReception')}</div>}
      <form class="stack" style={{ marginTop: 12 }} onSubmit={submit}>
        <Field label={t('void.reason')}>
          <input value={reason} onInput={(e) => setReason(e.currentTarget.value)} required minLength={2} placeholder={t('reverse.reasonPh')} />
        </Field>
        <button class="btn danger solid block" disabled={busy || reason.trim().length < 2 || !!blocked}>{t('reverse.confirm')}</button>
      </form>
    </Page>
  );
}
