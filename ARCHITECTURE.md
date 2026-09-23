# Architecture

## Stack (why)

One TypeScript codebase: a **Preact + Vite PWA** (≈83 KB gzipped JS, installable on Android and Windows, works fully offline through a Workbox service worker) storing everything on the device in **IndexedDB via Dexie**, and a **Node.js + Fastify** server storing everything in a single **SQLite** file (better-sqlite3). The shared domain code (`shared/`) — stock derivation, merge rules, permissions, reports, WhatsApp message text — runs identically on the phone and the server, so offline numbers and server numbers can't disagree. SQLite on one small VPS (≈ $5–6/month) is plenty for 3 stores, and backup is "copy one file". Every piece is mainstream and boring: no proprietary sync service, no paid database, no framework that will be abandoned next year.

```
 phone / laptop (PWA)                                   server (1 VPS)
┌───────────────────────────────┐   HTTPS, gzip   ┌──────────────────────────┐
│ UI (Preact)                   │                 │ Fastify                  │
│  └ reads IndexedDB (Dexie)    │  POST /push ──▶ │  validate (zod) + rights │
│ Engine                        │                 │  apply in 1 transaction: │
│  write = doc/patch + derived  │ ◀── GET /pull   │   doc → movements,       │
│          + outbox (1 tx)      │   (since seq)   │   stock level, ledger,   │
│  sync = push outbox, pull,    │                 │   audit, alerts          │
│         apply (1 tx)          │                 │ SQLite: records(seq)     │
└───────────────────────────────┘                 └──────────────────────────┘
```

## Data model

Three families of records (`shared/types.ts`):

| Family | Kinds | How it changes | How conflicts resolve |
|---|---|---|---|
| **Documents** (immutable facts) | sale, sale_void, repayment, purchase, adjustment, count, transfer_request, transfer_send, transfer_receive, cash_close, rate | Created once with a ULID, never edited. A correction is a new document (void, adjustment). | None possible: merge = union by id. Re-sending is a no-op. |
| **Entities** (mutable settings) | product, customer, supplier, store, user, minstock, photo, alert | Field patches `{field: value}` stamped with a hybrid logical clock (HLC). | Per-field last-writer-wins by HLC (`shared/merge.ts`). |
| **Derived** (server read models) | movement, stock, ledger, audit | Computed by the server from documents; never pushed by devices. | Deterministic ids from the source document, so they can't conflict. |

### Stock is a ledger, not a number

A sale does not "set stock to 4". It creates movements (`-1 × p_018 at Ibanda`) with deterministic ids (`<docId>:m<i>`). The server keeps `stock` = sum of movements per (store, product), updated in the same transaction as the insert. When two devices sell the last unit offline, both movements arrive, both are kept, stock becomes −1, and a `negative_stock` alert is raised for the manager. Nothing is overwritten and no sale is refused.

On the device, displayed stock = last server level + this device's movements not yet confirmed (`pending = 1`). When a push is confirmed, the same sync pulls the new level and clears the pending flag in one IndexedDB transaction, so the number never double-counts or dips.

### Customer debt is a ledger too

Credit sales add `+amount` ledger entries, repayments and voids add `−amount`. Ledger entries are visible to every store (a customer can buy in Kadutu and pay in Bagira). Aging uses FIFO: repayments pay off the oldest credit first.

## Conflict rules, by kind

| Data | Rule |
|---|---|
| Sales, purchases, adjustments, counts, repayments, cash closes | Immutable, union by id. Duplicate sends are ignored (op log + primary key). |
| Stock movements | Derived with deterministic ids; the server trusts its own derivation. Stock may go negative → alert. |
| Sale voids | One per sale (id = `void_<saleId>`). The server rebuilds the void's lines and credit from **its own copy of the sale**, ignoring what the device sent. |
| Transfers | Send (−stock at sender) and receive (+stock at receiver) are separate documents. One receive per send (id = `recv_<sendId>`). Quantity differences raise a `transfer_gap` alert at both stores. Stock in transit belongs to nobody until received. |
| Inventory counts | Each line stores the `expected` quantity the device saw and the `counted` quantity; the movement is the difference. If sales happened on another device during the count, those sales are still counted separately — the gap only corrects what this device knew. |
| Catalog edits (name, ref, fitments, category…) | Field-level LWW. Two people editing different fields both win; the same field → the later edit wins. Every change is audited with old → new. |
| Prices and cost | Same LWW, but need the `price.edit` right (managers, owner). Each sale keeps its own price and cost snapshot, so later price changes never change past sales or margins. |
| Exchange rate | Append-only `rate` documents; current rate = most recent by time. Each sale stores the rate it used. |
| Customers | Field-level LWW. Debt is not a field (it's the ledger), so it can't be overwritten. Credit limit needs `price.edit`. |
| Users | Owner only, except a user changing their own PIN. Deactivated users' offline sales are **kept** and flagged (`inactive_user` alert). |
| Minimum stock | One record per (store, product), LWW. |
| Alerts | Created by the server; `resolved` is LWW. A new negative level re-opens a resolved negative-stock alert. |
| Rejected operations | Stay on the device in the outbox with the reason, shown on the Sync screen and raised as a `rejected_op` alert. The server only remembers operations it **applied**, so "Retry" works once the cause is fixed (e.g. the missing customer now exists), and nobody can block an id by sending junk with it first. A manager can also discard (removes the local effect). Server errors (not the device's fault) keep the op pending and it is retried automatically. |

## Sync protocol

- `POST /api/sync/push {ops}` — ordered ops; each op is applied in its own SQLite transaction with all its effects. Results per op: `ok | duplicate` (the device can forget it), `rejected` (kept on the device, shown to the user), `error` (server problem, retried automatically).
- `GET /api/sync/pull?since=<seq>` — every record carries a global sequence number that increases on each write. A device pulls records with `seq > since` that it may see: global records plus its own store's records (the owner's all-store device sees everything). Pages of 1,000, gzip-compressed.
- Clocks: HLC strings `ms:counter:node`. Devices learn the server time on each sync and correct their clock (cheap phones are often days off), so `at` timestamps and business days are right.
- Business days use Bukavu time (UTC+2, no daylight saving) whatever the phone's time zone.
- Device time never goes below the last server time it has seen, so a phone whose date resets to 2000 after a dead battery still dates sales correctly. HLCs more than 5 minutes ahead of the server are replaced by the server's clock, so a wrong clock can't "lock" a field; documents dated in the future are brought back to the server's time.
- Push sends at most 200 ops or ~1.5 MB per request and keeps going until the queue is empty.
- **Restore from backup:** the server database has an `epoch`. `cli restore` sets a new one (and keeps today's devices and logins). When a device sees a new epoch it clears what came from the server, queues again every document it created itself (the server ignores the ones the backup already has), and downloads everything. Sales made after the backup are therefore recovered from the phones that made them. Edits to products/customers made after the backup are only recovered if still pending on a device.
- SQLite runs with `synchronous=FULL`: once the server has confirmed a sale to a phone, a power cut on the server cannot lose it.

## What each device can see

| Records | Visible to |
|---|---|
| products, customers, suppliers, users (without passwords), stores, rates, stock levels, debt ledger, transfers, minimum stock | every device |
| sales, voids, repayments, purchases, adjustments, counts, cash closes, movements, audit, alerts | devices of that store + owner's all-store devices |

## Security model

- **Device token** is the security boundary. A device is enrolled once, online, by a manager (their store only) or the owner (any store, or all). The token is random 256-bit, stored hashed on the server, revocable by the owner.
- **Owner on a store device** acts as that store's manager: managing users, stores, other stores and all-store reports need the owner's own all-store device. (PINs are checked on the device only, so otherwise a store device could forge owner actions.)
- **PIN** switching (4–6 digits, PBKDF2 on the device) lets sellers share a phone offline. It protects against casual misuse at the counter, not against someone who has the unlocked phone and dev tools. The server re-checks everything: user belongs to the device's store, role allows the action, document's store matches, amounts add up, referenced sale/transfer exist.
- Passwords (owner/managers only) are scrypt-hashed and only used online: enrolling devices, backups, device list, setting other logins. Failed logins are limited per IP and per username (10 per 10 minutes); a successful login only clears its own username.
- Every document is re-checked by the server: products must exist, sale totals and payment conversions must add up (sales and repayments), voids and transfer receptions are rebuilt from the server's own copy of the sale / transfer.
- Audit of edits made on the owner's all-store device and rejected-op alerts from it are only visible to owner devices.
- HTTPS is required (Caddy provides it automatically).

## WhatsApp

`shared/notify.ts` defines `NotificationService` + `NotificationChannel`. Today the app uses two client channels: the share sheet (receipt image attached) and `wa.me` links (chat opened with text ready). The server has a `WhatsAppCloudChannel` and scheduled jobs (daily summary, low stock, weekly debt reminders) that run only when `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set. All message text is in `shared/messages.ts` + `shared/locales/fr.json`. See `WHATSAPP.md`.

## i18n

All UI and message text lives in `shared/locales/fr.json` (flat keys, `{param}` placeholders). To add English or Swahili: copy the file to `en.json`/`sw.json`, translate, register it in `shared/i18n.ts`, and set `localStorage.lang`. A test fails if code uses a key that is missing from `fr.json`.

## Files

```
shared/   domain code used by both sides (types, derive, merge, hlc, permissions, reports, messages, i18n)
server/   Fastify app, SQLite, sync, auth, seed/demo data, CLI (init, demo, backup, restore), WhatsApp jobs
src/      PWA: core/engine.ts (outbox + sync), core/db.ts (IndexedDB), pages/*, ui.tsx, share.ts, scanner.tsx
tests/    vitest: sync scenarios with real server + fake IndexedDB, security, reports, i18n
e2e/      Playwright: installable PWA, offline reload, 3-tap sale, receipt share, transfer, resync
```
