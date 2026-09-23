import { db, engine, t, useLive, useSession } from '../state';
import { Page } from '../ui';
import type { Action } from '../../shared/permissions';

export function MenuPage() {
  const s = useSession();
  const alerts = useLive(
    () => db.alert.filter((a) => !a.resolved && (s.allStores || !a.storeId || a.storeId === s.storeId)).count(),
    [s.storeId],
    0,
  );
  const incoming = useLive(
    async () => {
      const sends = await db.transfer_send.where('toStoreId').equals(s.storeId).toArray();
      const recv = new Set((await db.transfer_receive.toArray()).map((r) => r.sendId));
      return sends.filter((x) => !recv.has(x.id)).length;
    },
    [s.storeId],
    0,
  );
  const groups: { title: string; items: { href: string; label: string; hint?: string; badge?: number; need?: Action }[] }[] = [
    {
      title: t('menu.stock'),
      items: [
        { href: '/transfers', label: t('menu.transfers'), hint: t('menu.transfersHint'), badge: incoming },
        { href: '/purchases', label: t('menu.purchases'), hint: t('menu.purchasesHint'), need: 'purchase' },
        { href: '/counts', label: t('menu.counts'), hint: t('menu.countsHint'), need: 'count' },
        { href: '/adjust', label: t('menu.adjust'), hint: t('menu.adjustHint'), need: 'adjust' },
        { href: '/stock', label: t('menu.stockLevels') },
        { href: '/suppliers', label: t('menu.suppliers'), need: 'supplier.edit' },
      ],
    },
    {
      title: t('menu.money'),
      items: [
        { href: '/cash', label: t('menu.cash'), hint: t('menu.cashHint'), need: 'cash.close' },
        { href: '/sales', label: t('menu.sales') },
        { href: '/rate', label: t('menu.rate'), hint: t('menu.rateHint', { rate: s.rate }) },
      ],
    },
    {
      title: t('menu.control'),
      items: [
        { href: '/alerts', label: t('menu.alerts'), badge: alerts, need: 'alert.resolve' },
        { href: '/audit', label: t('menu.audit'), need: 'audit.view' },
        { href: '/users', label: t('menu.users'), need: 'user.manage' },
        { href: '/stores', label: t('menu.stores'), need: 'store.manage' },
      ],
    },
    {
      title: t('menu.device'),
      items: [
        { href: '/sync', label: t('menu.sync'), hint: engine.status.pending ? t('sync.pending', { n: engine.status.pending }) : t('sync.synced') },
        { href: '/device', label: t('menu.deviceInfo') },
      ],
    },
  ];
  return (
    <Page title={t('menu.title')}>
      {groups.map((g) => {
        const items = g.items.filter((i) => !i.need || s.can(i.need));
        if (!items.length) return null;
        return (
          <>
            <h2 style={{ margin: '18px 0 6px' }}>{g.title}</h2>
            <div class="list">
              {items.map((i) => (
                <a class="item" href={`#${i.href}`}>
                  <div class="main">
                    <div class="title">{i.label}</div>
                    {i.hint && <div class="sub">{i.hint}</div>}
                  </div>
                  {!!i.badge && <span class="tag warn">{i.badge}</span>}
                </a>
              ))}
            </div>
          </>
        );
      })}
      <button class="btn block" style={{ marginTop: 20 }} onClick={s.logout}>
        {t('login.switch')}
      </button>
    </Page>
  );
}
