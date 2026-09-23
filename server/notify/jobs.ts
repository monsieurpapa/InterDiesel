// Automatic messages, ready for when the WhatsApp Business Cloud API is enabled:
// - 19:30 Bukavu time: daily summary per store to the owner
// - 19:30: low-stock list to each store manager
// - Monday 09:00: debt reminders to customers with a balance older than 14 days
// Without Cloud API credentials, messages go to the log channel (no-op).
import type { DB } from '../db';
import { listKind } from '../db';
import { createT, LOCALES, DEFAULT_LANG } from '../../shared/i18n';
import { NotificationService, type OutgoingMessage } from '../../shared/notify';
import { customerBalances, daySummary } from '../../shared/reports';
import { dailySummaryText, debtReminderText, lowStockText } from '../../shared/messages';
import { stockId } from '../../shared/derive';
import { dayKey, DAY_MS, TZ_OFFSET_MS } from '../../shared/time';
import { fmtUSD } from '../../shared/money';
import type { Customer, LedgerEntry, MinStock, Product, RateDoc, Store, User } from '../../shared/types';
import { LogChannel, WhatsAppCloudChannel } from './whatsapp-cloud';

const t = createT(LOCALES[process.env.LANG_APP ?? DEFAULT_LANG] ?? LOCALES.fr);

export function buildMessages(db: DB, now: number, which: 'evening' | 'monday'): OutgoingMessage[] {
  const stores = listKind(db, 'store').filter((s: Store) => s.active) as Store[];
  const users = listKind(db, 'user') as User[];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const owner = users.find((u) => u.role === 'owner' && u.active);
  const msgs: OutgoingMessage[] = [];

  if (which === 'evening') {
    const day = dayKey(now);
    const since = now - 2 * DAY_MS;
    const recent = (k: string) => listKind(db, k).filter((d: any) => d.at >= since);
    const sales = recent('sale');
    const voids = recent('sale_void');
    const reps = recent('repayment');
    const products = new Map((listKind(db, 'product') as Product[]).map((p) => [p.id, p]));
    const stock = new Map(listKind(db, 'stock').map((s: any) => [s.id, s.qty as number]));
    const mins = listKind(db, 'minstock') as MinStock[];
    for (const s of stores) {
      const sum = daySummary(day, s.id, sales, voids, reps);
      const text = dailySummaryText(t, sum, s.name, names);
      if (owner?.phone)
        msgs.push({ kind: 'daily_summary', to: owner.phone, text, template: { name: 'rapport_journalier', language: 'fr', params: [s.name, day, String(sum.count), fmtUSD(sum.totalUSD)] } });
      const low = mins
        .filter((m) => m.storeId === s.id && m.min > 0)
        .map((m) => ({ p: products.get(m.productId)!, qty: stock.get(stockId(s.id, m.productId)) ?? 0, min: m.min }))
        .filter((x) => x.p?.active && x.qty <= x.min);
      const manager = users.find((u) => u.role === 'manager' && u.storeId === s.id && u.active);
      if (low.length && manager?.phone)
        msgs.push({ kind: 'low_stock', to: manager.phone, text: lowStockText(t, s.name, low), template: { name: 'stock_bas', language: 'fr', params: [s.name, String(low.length)] } });
    }
  } else {
    const ledger = listKind(db, 'ledger') as LedgerEntry[];
    const customers = new Map((listKind(db, 'customer') as Customer[]).map((c) => [c.id, c]));
    const rate = (listKind(db, 'rate') as RateDoc[]).sort((a, b) => b.at - a.at)[0]?.cdfPerUsd ?? 2300;
    for (const b of customerBalances(ledger, now).values()) {
      const c = customers.get(b.customerId);
      if (!c?.phone || b.balanceUSD < 1 || !b.oldestUnpaidAt || now - b.oldestUnpaidAt < 14 * DAY_MS) continue;
      msgs.push({
        kind: 'debt_reminder',
        to: c.phone,
        text: debtReminderText(t, c, b.balanceUSD, rate, 'Inter-Diesel'),
        template: { name: 'rappel_dette', language: 'fr', params: [c.name, fmtUSD(b.balanceUSD)] },
      });
    }
  }
  return msgs;
}

export function startDailyJobs(db: DB) {
  const cloud = new WhatsAppCloudChannel();
  const service = new NotificationService([cloud, new LogChannel()]);
  if (!cloud.configured) console.log('WhatsApp Business API non configurée: messages automatiques désactivés (voir WHATSAPP.md).');
  let lastRun = '';
  const timer = setInterval(async () => {
    const now = Date.now();
    const local = new Date(now + TZ_OFFSET_MS);
    const hm = local.getUTCHours() * 60 + local.getUTCMinutes();
    const key = `${dayKey(now)}:${hm}`;
    if (key === lastRun) return;
    let which: 'evening' | 'monday' | null = null;
    if (hm === 19 * 60 + 30) which = 'evening';
    else if (hm === 9 * 60 && local.getUTCDay() === 1) which = 'monday';
    if (!which) return;
    lastRun = key;
    if (!cloud.configured && process.env.NOTIFY_LOG !== '1') return;
    for (const m of buildMessages(db, now, which)) await service.send(m);
  }, 20_000);
  timer.unref();
}
