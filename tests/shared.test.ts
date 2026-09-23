import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fr from '../shared/locales/fr.json';
import { applyPatch } from '../shared/merge';
import { HLC } from '../shared/hlc';
import { collected, customerBalances, daySummary, expectedDrawer } from '../shared/reports';
import { roundCdf, toUSD, usdToCdf } from '../shared/money';
import { validateDoc } from '../shared/schemas';
import { dayKey } from '../shared/time';
import type { LedgerEntry, Sale } from '../shared/types';

const DAY = 86_400_000;

describe('i18n', () => {
  it('every literal t("key") used in the code exists in fr.json', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    ['src', 'shared', 'server'].forEach(walk);
    const missing = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) if (!(m[1] in fr)) missing.add(m[1]);
    }
    expect([...missing]).toEqual([]);
  });

  it('dynamic key families are complete', () => {
    const need = [
      ...['cash', 'mpesa', 'airtel', 'orange', 'credit'].map((k) => `pay.${k}`),
      ...['owner', 'manager', 'seller'].map((k) => `role.${k}`),
      ...['sale', 'void', 'purchase', 'adjustment', 'count', 'transfer_out', 'transfer_in'].map((k) => `move.${k}`),
      ...['damaged', 'lost', 'found', 'returned_supplier', 'customer_return', 'correction', 'other'].map((k) => `reason.${k}`),
      ...['negative_stock', 'transfer_gap', 'inactive_user', 'count_gap', 'rejected_op'].map((k) => `alert.${k}`),
      ...['idle', 'syncing', 'offline', 'error', 'revoked'].map((k) => `sync.state.${k}`),
      ...['credit_sale', 'repayment', 'void'].map((k) => `ledger.${k}`),
    ];
    expect(need.filter((k) => !(k in fr))).toEqual([]);
  });
});

describe('merge and clocks', () => {
  it('last writer wins per field and is idempotent', () => {
    const a = applyPatch({ id: 'p' }, {}, { name: 'A', priceUSD: 1 }, '0000000000001:00000:x');
    const b = applyPatch(a.data, a.clocks, { priceUSD: 2 }, '0000000000003:00000:y');
    const old = applyPatch(b.data, b.clocks, { priceUSD: 9, name: 'B' }, '0000000000002:00000:z');
    expect(old.data).toMatchObject({ name: 'B', priceUSD: 2 });
    const again = applyPatch(old.data, old.clocks, { name: 'B' }, '0000000000002:00000:z');
    expect(again.changed).toEqual({});
  });

  it('HLC never goes backwards even if the phone clock does', () => {
    let now = 1_800_000_000_000;
    const c = new HLC('d1', () => now);
    const a = c.tick();
    now -= 60_000;
    const b = c.tick();
    expect(b > a).toBe(true);
    c.observe('1900000000000:00007:server');
    expect(c.tick() > '1900000000000:00007:server').toBe(true);
  });
});

describe('money and reports', () => {
  it('rounds francs up to 50 FC and converts both ways', () => {
    expect(roundCdf(5751)).toBe(5800);
    expect(usdToCdf(2.5, 2300)).toBe(5750);
    expect(toUSD(23000, 'CDF', 2300)).toBe(10);
  });

  const sale = (over: Partial<Sale>): Sale => ({
    id: 's1', storeId: 'A', userId: 'u', deviceId: 'd', at: Date.parse('2026-09-20T10:00:00Z'), no: 'X', rate: 2300,
    lines: [{ productId: 'p', name: 'p', ref: 'p', qty: 2, unitUSD: 5, costUSD: 3 }], discountUSD: 0, totalUSD: 10,
    payments: [{ method: 'cash', currency: 'USD', amount: 10, amountUSD: 10 }], changeUSD: 0, ...over,
  });

  it('cash collected removes the change given back', () => {
    const s = sale({ payments: [{ method: 'cash', currency: 'CDF', amount: 25000, amountUSD: 10.87 }], changeUSD: 0.87 });
    expect(collected(s)['cash:CDF']).toBe(23000);
  });

  it('day summary and expected drawer', () => {
    const s1 = sale({});
    const s2 = sale({ id: 's2', payments: [{ method: 'credit', currency: 'USD', amount: 10, amountUSD: 10 }], customerId: 'c' });
    const day = dayKey(s1.at);
    const sum = daySummary(day, 'A', [s1, s2], [], []);
    expect(sum).toMatchObject({ count: 2, totalUSD: 20, costUSD: 12, marginUSD: 8, creditUSD: 10 });
    const rep = { id: 'r', storeId: 'A', userId: 'u', deviceId: 'd', at: s1.at + 1000, customerId: 'c', method: 'cash' as const, currency: 'USD' as const, amount: 4, amountUSD: 4, rate: 2300 };
    expect(expectedDrawer(day, 'A', [s1, s2], [], [rep])['cash:USD']).toBe(14);
  });

  it('debt aging pays the oldest credit first', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    const e = (id: string, amt: number, daysAgo: number): LedgerEntry => ({ id, customerId: 'c', storeId: 'A', amountUSD: amt, kind: amt > 0 ? 'credit_sale' : 'repayment', ref: id, at: now - daysAgo * DAY });
    const b = customerBalances([e('a', 100, 95), e('b', 50, 40), e('r', -120, 10), e('c', 30, 5)], now).get('c')!;
    expect(b.balanceUSD).toBe(60);
    expect(b.buckets).toEqual({ d0_30: 30, d31_60: 30, d61_90: 0, d90p: 0 });
  });
});

describe('server validation', () => {
  it('rejects a sale whose total does not add up or is underpaid', () => {
    const base = {
      id: 's1', storeId: 'A', userId: 'u', deviceId: 'd', at: 1_790_000_000_000, no: 'X', rate: 2300,
      lines: [{ productId: 'p', name: 'p', ref: 'p', qty: 2, unitUSD: 5, costUSD: 3 }], discountUSD: 0, totalUSD: 10,
      payments: [{ method: 'cash', currency: 'USD', amount: 10, amountUSD: 10 }], changeUSD: 0,
    };
    expect(validateDoc('sale', base).ok).toBe(true);
    expect(validateDoc('sale', { ...base, totalUSD: 8 }).ok).toBe(false);
    expect(validateDoc('sale', { ...base, payments: [{ method: 'cash', currency: 'USD', amount: 5, amountUSD: 5 }] }).ok).toBe(false);
    expect(validateDoc('sale', { ...base, payments: [{ method: 'credit', currency: 'USD', amount: 10, amountUSD: 10 }] }).ok).toBe(false);
  });
});
