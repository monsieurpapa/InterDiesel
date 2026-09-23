// Bukavu is UTC+2 all year (no daylight saving). Business days are computed in
// that zone whatever the phone's own time-zone setting says.
export const TZ_OFFSET_MS = 2 * 3_600_000;
export const DAY_MS = 86_400_000;

export function dayKey(ts: number): string {
  return new Date(ts + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of the business day (ms, UTC) for a YYYY-MM-DD key. */
export function dayStart(key: string): number {
  return Date.parse(`${key}T00:00:00Z`) - TZ_OFFSET_MS;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts + TZ_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts + TZ_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}
