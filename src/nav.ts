// Breadcrumb trail: where a page sits in the app, so people always see the way back.
// Only the parents are listed; the page title itself is shown below the trail.
import { t, type Session } from './state';

export interface Crumb {
  label: string;
  href: string;
}

const C = {
  sell: (): Crumb => ({ label: t('nav.sell'), href: '/' }),
  products: (): Crumb => ({ label: t('nav.products'), href: '/products' }),
  customers: (): Crumb => ({ label: t('nav.customers'), href: '/customers' }),
  reports: (): Crumb => ({ label: t('nav.reports'), href: '/reports' }),
  menu: (): Crumb => ({ label: t('nav.menu'), href: '/menu' }),
  sales: (): Crumb => ({ label: t('sales.title'), href: '/sales' }),
  stock: (): Crumb => ({ label: t('stock.title'), href: '/stock' }),
  cash: (): Crumb => ({ label: t('cash.title'), href: '/cash' }),
  transfers: (): Crumb => ({ label: t('transfers.title'), href: '/transfers' }),
  purchases: (): Crumb => ({ label: t('purchases.title'), href: '/purchases' }),
  suppliers: (): Crumb => ({ label: t('menu.suppliers'), href: '/suppliers' }),
  counts: (): Crumb => ({ label: t('counts.title'), href: '/counts' }),
  users: (): Crumb => ({ label: t('users.title'), href: '/users' }),
  stores: (): Crumb => ({ label: t('stores.title'), href: '/stores' }),
};

/** Parents of the page at `path` (hash route split on "/"). Empty for the 5 main tabs. */
export function trailFor(path: string[], s: Session | null, query?: URLSearchParams): Crumb[] {
  const [a, b, c] = path;
  const productName = (id: string) => s?.productById.get(id)?.name ?? t('nav.products');
  const customerName = (id: string) => s?.customers.find((x) => x.id === id)?.name ?? t('nav.customers');
  switch (a) {
    case 'sales':
      return [C.reports()];
    case 'sale':
      if (query?.get('new') === '1') return []; // receipt right after a sale: "Nouvelle vente" is the way on
      return c === 'void' ? [C.reports(), C.sales(), { label: t('receipt.short'), href: `/sale/${b}` }] : [C.reports(), C.sales()];
    case 'cash':
      return [C.reports()];
    case 'stock':
      return [C.products()];
    case 'adjust':
      return [C.products()];
    case 'product':
      return c === 'edit' ? [C.products(), { label: productName(b), href: `/product/${b}` }] : [C.products()];
    case 'customer':
      return c === 'edit' ? [C.customers(), { label: customerName(b), href: `/customer/${b}` }] : [C.customers()];
    case 'transfers':
    case 'purchases':
    case 'suppliers':
    case 'counts':
    case 'alerts':
    case 'audit':
    case 'rate':
    case 'sync':
    case 'device':
    case 'users':
    case 'stores':
      return [C.menu()];
    case 'transfer':
      return [C.menu(), C.transfers()];
    case 'purchase':
      return [C.menu(), C.purchases()];
    case 'supplier':
      return [C.menu(), C.suppliers()];
    case 'count':
      return [C.menu(), C.counts()];
    case 'user':
      return [C.menu(), C.users()];
    case 'store':
      return [C.menu(), C.stores()];
    case 'reverse': {
      const doc = (href: string): Crumb => ({ label: t('reverse.document'), href });
      switch (b) {
        case 'purchase':
          return [C.menu(), C.purchases(), doc(`/purchase/${c}`)];
        case 'transfer_send':
        case 'transfer_request':
        case 'transfer_receive':
          return [C.menu(), C.transfers()];
        case 'count':
          return [C.menu(), C.counts(), doc(`/count/${c}`)];
        case 'adjustment':
          return [C.products(), C.stock()];
        case 'repayment':
          return [C.customers()];
        case 'cash_close':
          return [C.reports(), C.cash()];
        default:
          return [C.menu()];
      }
    }
    default:
      return [];
  }
}
