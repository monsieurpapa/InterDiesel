// Field-level last-writer-wins merge for mutable records (products, customers...).
// Two people editing different fields of the same product both keep their edit;
// on the same field, the later HLC wins. Applying the same patch twice is a no-op.

export type Clocks = Record<string, string>;

export interface MergeResult {
  data: Record<string, unknown>;
  clocks: Clocks;
  changed: Record<string, [unknown, unknown]>; // field -> [before, after]
}

export function applyPatch(
  data: Record<string, unknown>,
  clocks: Clocks,
  fields: Record<string, unknown>,
  hlc: string,
): MergeResult {
  const out = { ...data };
  const outClocks = { ...clocks };
  const changed: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'id') continue;
    const cur = outClocks[k];
    if (cur !== undefined && cur >= hlc) continue; // an equal or newer write already won
    outClocks[k] = hlc;
    if (!sameValue(out[k], v)) changed[k] = [out[k], v];
    out[k] = v;
  }
  return { data: out, clocks: outClocks, changed };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
