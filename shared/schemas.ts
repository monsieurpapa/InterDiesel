// Server-side validation of everything a device pushes. Imported by the server
// only, so zod never ships in the phone bundle.
import { z } from 'zod';
import { round2 } from './money';
import type { DocKind, EntityKind } from './types';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_:\-]+$/);
const money = z.number().finite().min(0).max(10_000_000);
const qty = z.number().int().min(1).max(100_000);
const signedQty = z.number().int().min(-100_000).max(100_000);
const text = (max = 500) => z.string().max(max);
const currency = z.enum(['USD', 'CDF']);
const at = z.number().int().min(1_500_000_000_000).max(4_000_000_000_000);

const base = {
  id,
  storeId: id,
  userId: id,
  deviceId: id,
  at,
};

const payment = z.object({
  method: z.enum(['cash', 'mpesa', 'airtel', 'orange', 'credit']),
  currency,
  amount: money,
  amountUSD: money,
});

const sale = z
  .object({
    ...base,
    no: text(40),
    customerId: id.nullable().optional(),
    rate: z.number().positive().max(1_000_000),
    lines: z
      .array(
        z.object({
          productId: id,
          name: text(200),
          ref: text(80),
          qty,
          unitUSD: money,
          costUSD: money,
        }),
      )
      .min(1)
      .max(200),
    discountUSD: money,
    totalUSD: money,
    payments: z.array(payment).min(1).max(10),
    changeUSD: money,
    note: text().optional(),
  })
  .superRefine((s, ctx) => {
    const gross = s.lines.reduce((a, l) => a + l.qty * l.unitUSD, 0);
    if (Math.abs(round2(gross - s.discountUSD) - s.totalUSD) > 0.011) ctx.addIssue({ code: 'custom', message: 'total_mismatch' });
    const paid = s.payments.reduce((a, p) => a + p.amountUSD, 0);
    if (round2(paid - s.changeUSD) + 0.011 < s.totalUSD) ctx.addIssue({ code: 'custom', message: 'underpaid' });
    if (s.payments.some((p) => p.method === 'credit') && !s.customerId) ctx.addIssue({ code: 'custom', message: 'credit_needs_customer' });
    for (const p of s.payments) {
      const expect = p.currency === 'USD' ? p.amount : p.amount / s.rate;
      if (Math.abs(round2(expect) - p.amountUSD) > 0.011) ctx.addIssue({ code: 'custom', message: 'payment_conversion' });
    }
  });

const tline = z.object({ productId: id, qty });

const schemas: Record<DocKind, z.ZodTypeAny> = {
  sale,
  sale_void: z.object({
    ...base,
    saleId: id,
    saleNo: text(40),
    reason: text(300).min(2),
    lines: z.array(z.object({ productId: id, qty })).min(1).max(200),
    customerId: id.nullable().optional(),
    creditUSD: money,
    refundUSD: money,
  }),
  repayment: z
    .object({
      ...base,
      customerId: id,
      method: z.enum(['cash', 'mpesa', 'airtel', 'orange']),
      currency,
      amount: money.positive(),
      amountUSD: money.positive(),
      rate: z.number().positive().max(1_000_000),
      note: text().optional(),
    })
    .refine((r) => Math.abs(round2(r.currency === 'USD' ? r.amount : r.amount / r.rate) - r.amountUSD) <= 0.011, { message: 'payment_conversion' }),
  purchase: z.object({
    ...base,
    supplierId: id.nullable(),
    invoiceNo: text(60).optional(),
    lines: z.array(z.object({ productId: id, qty, unitCostUSD: money })).min(1).max(500),
    totalUSD: money,
    note: text().optional(),
  }),
  adjustment: z.object({
    ...base,
    productId: id,
    qty: signedQty.refine((n) => n !== 0),
    reason: z.enum(['damaged', 'lost', 'found', 'returned_supplier', 'customer_return', 'correction', 'other']),
    note: text().min(2),
  }),
  count: z.object({
    ...base,
    lines: z
      .array(z.object({ productId: id, expected: signedQty, counted: z.number().int().min(0).max(100_000) }))
      .min(1)
      .max(5000),
    note: text().optional(),
  }),
  transfer_request: z.object({ ...base, fromStoreId: id, lines: z.array(tline).min(1).max(500), note: text().optional() }),
  transfer_send: z.object({
    ...base,
    toStoreId: id,
    requestId: id.nullable().optional(),
    lines: z.array(tline).min(1).max(500),
    note: text().optional(),
  }),
  transfer_receive: z.object({
    ...base,
    sendId: id,
    fromStoreId: id,
    lines: z.array(z.object({ productId: id, qty: z.number().int().min(0).max(100_000) })).min(1).max(500),
    note: text().optional(),
  }),
  cash_close: z.object({
    ...base,
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expected: z.record(z.string().max(20), z.number().finite()),
    counted: z.record(z.string().max(20), z.number().finite()),
    note: text().optional(),
  }),
  rate: z.object({ ...base, cdfPerUsd: z.number().min(100).max(100_000) }),
};

export function validateDoc(kind: DocKind, data: unknown): { ok: true; data: any } | { ok: false; error: string } {
  const r = schemas[kind].safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ').slice(0, 300) };
}

const fit = z.object({ brand: text(60), model: text(80), years: text(20).optional() });

const entityFields: Record<EntityKind, z.ZodObject<any>> = {
  store: z.object({ name: text(80), code: text(6), address: text(200), phone: text(30), active: z.boolean() }),
  user: z.object({
    name: text(80),
    role: z.enum(['owner', 'manager', 'seller']),
    storeId: id.nullable(),
    pinHash: text(200),
    phone: text(30),
    active: z.boolean(),
    username: text(40),
  }),
  product: z.object({
    ref: text(80),
    barcode: text(80),
    name: text(200).min(1),
    brand: text(80),
    category: text(80),
    fits: z.array(fit).max(50),
    costUSD: money,
    priceUSD: money,
    priceCDF: money.nullable(),
    unit: text(20),
    active: z.boolean(),
  }),
  customer: z.object({
    name: text(120).min(1),
    phone: text(30),
    note: text(),
    creditLimitUSD: money.nullable(),
    active: z.boolean(),
  }),
  supplier: z.object({ name: text(120).min(1), phone: text(30), city: text(60), note: text(), active: z.boolean() }),
  minstock: z.object({ storeId: id, productId: id, min: z.number().int().min(0).max(100_000) }),
  photo: z.object({ dataUrl: z.string().max(120_000).regex(/^data:image\/(jpeg|png|webp);base64,/) }),
  alert: z.object({ resolved: z.boolean(), resolvedBy: id, resolvedAt: at }),
};

export function validatePatch(kind: EntityKind, fields: unknown): { ok: true; data: any } | { ok: false; error: string } {
  const r = entityFields[kind].partial().strict().safeParse(fields);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ').slice(0, 300) };
}
