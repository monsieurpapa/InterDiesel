import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { liveQuery } from 'dexie';
import { LocalDB } from './core/db';
import { Engine } from './core/engine';
import { createT, LOCALES, DEFAULT_LANG } from '../shared/i18n';
import type { Action } from '../shared/permissions';
import type { Customer, Product, Store, User } from '../shared/types';

export const db = new LocalDB();
export const engine = new Engine(db);

const lang = (() => {
  try {
    return localStorage.getItem('lang') || DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
})();
export const t = createT(LOCALES[lang] ?? LOCALES[DEFAULT_LANG]);

/** Re-renders whenever the data read by `fn` changes in IndexedDB. */
export function useLive<T>(fn: () => Promise<T> | T, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: (v) => setValue(v), error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  }, deps);
  return value;
}

export interface Session {
  user: User;
  /** Store the user is working in. For the owner on an all-stores device, it can be changed. */
  storeId: string;
  store: Store;
  stores: Store[];
  users: User[];
  products: Product[];
  productById: Map<string, Product>;
  customers: Customer[];
  rate: number;
  allStores: boolean; // device sees every store (owner device)
  can: (a: Action) => boolean;
  setStore: (id: string) => void;
  logout: () => void;
}

export const SessionContext = createContext<Session | null>(null);
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('no session');
  return s;
}

/**
 * Stock per product for a store as the device knows it: the last level received
 * from the server plus this device's operations not yet confirmed.
 */
export async function stockMap(storeId: string | null): Promise<Map<string, number>> {
  const levels = storeId ? await db.stock.where('storeId').equals(storeId).toArray() : await db.stock.toArray();
  const pending = await db.movement.where('pending').equals(1).toArray();
  const m = new Map<string, number>();
  const key = (s: string, p: string) => (storeId ? p : `${s}:${p}`);
  for (const l of levels) m.set(key(l.storeId, l.productId), (m.get(key(l.storeId, l.productId)) ?? 0) + l.qty);
  for (const mv of pending) {
    if (storeId && mv.storeId !== storeId) continue;
    const k = key(mv.storeId, mv.productId);
    m.set(k, (m.get(k) ?? 0) + mv.qty);
  }
  return m;
}

export function useStock(storeId: string | null) {
  return useLive(() => stockMap(storeId), [storeId], new Map<string, number>());
}

export async function currentRate(): Promise<number> {
  const last = await db.rate.orderBy('at').last();
  return last?.cdfPerUsd ?? 2300;
}

/** Tiny hash router: #/path/segments?query */
export function useRoute(): { path: string[]; query: URLSearchParams } {
  const parse = () => {
    const h = location.hash.replace(/^#\/?/, '');
    const [p, q] = h.split('?');
    return { path: p ? p.split('/').map(decodeURIComponent) : [], query: new URLSearchParams(q ?? '') };
  };
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => {
      setR(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function go(path: string) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}
export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else go(fallback);
}

/** Short-lived message at the bottom of the screen. */
let toastFn: ((msg: string, kind?: 'ok' | 'error') => void) | null = null;
export function setToastHandler(fn: typeof toastFn) {
  toastFn = fn;
}
export function toast(msg: string, kind: 'ok' | 'error' = 'ok') {
  toastFn?.(msg, kind);
}

/** Human message for an error code from the server or the network. */
export function errText(code?: string | null): string {
  const k = `error.${String(code ?? '').split(':')[0]}`;
  const s = t(k);
  return s === k ? t('error.generic') : s;
}
