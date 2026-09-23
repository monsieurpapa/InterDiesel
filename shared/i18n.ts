// Minimal i18n: flat keys, {param} interpolation. All user-facing text lives in
// shared/locales/<lang>.json. Adding English or Swahili = adding a JSON file.
import fr from './locales/fr.json';

export type Dict = Record<string, string>;
export const LOCALES: Record<string, Dict> = { fr };
export const DEFAULT_LANG = 'fr';

export function createT(dict: Dict, fallback: Dict = fr) {
  return function t(key: string, params?: Record<string, string | number>): string {
    // French plural: 0 and 1 use the "_one" form when the locale file has one.
    const n = params?.n;
    const oneKey = `${key}_one`;
    let s = (typeof n === 'number' && Math.abs(n) < 2 && (dict[oneKey] ?? fallback[oneKey])) || dict[key] || fallback[key] || key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

export type T = ReturnType<typeof createT>;
