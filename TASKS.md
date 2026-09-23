# Tasks

## Done
- [x] Research: WhatsApp Cloud API rules and pricing (Sep 2026), USD/CDF rate
- [x] Shared domain: types, HLC clock, field-level merge, stock/debt derivation, permissions, reports, messages, i18n
- [x] Server: SQLite store, push/pull sync, device enrollment, scrypt passwords, rate limiting, backups, CLI (init/demo/backup/restore/password)
- [x] Demo data: 67 Bukavu parts (Bajaj Boxer, TVS, Haojue, Toyota, lubricants), 3 stores, 10 users, 12 customers, 4 suppliers, 45 days of sales, debts, transfers
- [x] PWA: offline shell (service worker), IndexedDB, outbox sync engine, sync badge + offline bar
- [x] 1 Catalog: search by name/ref/model, categories, fitments, USD + CDF prices, photo, camera barcode/QR scan, USB scanners
- [x] 2 Stock per store: levels, low-stock (per store minimum), negative flag, transfers (request/send/receive with gaps), adjustments with reason, inventory counts with gaps
- [x] 3 Sales: 3-tap checkout, cart edit, discounts ($/%), mixed payments USD/FC/Mobile Money, credit with confirmation, receipt image/text on WhatsApp, 58 mm print, void
- [x] 4 Purchases: suppliers, purchase entries, cost update, cost history
- [x] 5 Customers and debts: balances, repayments in any store, aging (FIFO), WhatsApp reminder
- [x] 6 Reports: sales per store/seller/method/day, margin, cash close, best sellers, slow movers, stock value; owner all stores, managers own store, sellers their day
- [x] 7 Users/roles: owner/manager/seller, PIN switch, auto-lock, audit log of stock/price/money changes
- [x] 8 WhatsApp: share sheet + wa.me today; NotificationService interface; Cloud API channel + scheduled jobs (off by default); WHATSAPP.md
- [x] Tests: 34 unit/integration (incl. two stores/devices selling the same stock offline), 2 Playwright end-to-end (offline PWA)
- [x] Parallel review (sync integrity, security, small-screen UX) and fixes:
  - [x] rejected ops can be retried; ids can't be squatted; server errors are retried, not rejected
  - [x] owner on a store device limited to that store's manager rights
  - [x] future clocks can't lock fields; phones with reset dates still date sales correctly
  - [x] restore from backup: epoch + devices re-send their own documents; SQLite synchronous=FULL
  - [x] whole backlog pushed in one sync, requests capped by size
  - [x] repayment conversion checked, products must exist, owner audit not leaked to stores, login limiter per username
  - [x] credit sale confirmation with debt and limit, toast placement, 48px targets, short store names, plurals, table alignment
- [x] Docker + Caddy (HTTPS) + daily backups; README for non-developers

## Next (not done)
- [ ] Test on the real phones in the stores (Tecno/Itel/Samsung A-series) and a real 58 mm Bluetooth printer
- [ ] Owner decides on assumptions in ASSUMPTIONS.md (discount limits per role, supplier debts, Mobile Money in FC)
- [ ] Import the real catalog (CSV import screen) and opening stock
- [ ] Meta Business verification + template approval, then set WHATSAPP_TOKEN (see WHATSAPP.md)
- [ ] Limit initial download on new phones (movements/audit older than 6 months) once data grows
- [ ] Export of unsent operations to a file (shared over WhatsApp) for a phone that breaks before syncing
- [ ] English and Swahili translations (copy `shared/locales/fr.json`)
- [ ] Off-server automatic backup (e.g. to Google Drive or another VPS)
