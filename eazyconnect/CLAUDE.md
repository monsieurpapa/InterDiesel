# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

EAZY KONNECT is a WiFi voucher management system for distributing Starlink-backhauled internet in Goma, DRC. Users buy time-limited vouchers (like a cybercafé), connect to the WiFi, enter the code on the captive portal, and get internet for the duration. All user-facing text is in **French**.

## Commands

```bash
npm start        # Production server (port 3000)
npm run dev      # Development with auto-reload (nodemon)
```

No test suite exists. Manual testing via curl or the browser UI.

Quick API smoke test (default password is `admin` if `.env` is absent):
```bash
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/auth -X POST -H "Content-Type: application/json" -d '{"password":"admin"}'
curl -s http://localhost:3000/api/packages -H "Authorization: Bearer admin"
curl -s http://localhost:3000/api/vouchers/batch -X POST -H "Authorization: Bearer admin" -H "Content-Type: application/json" -d '{"packageId":1,"quantity":5}'
```

## Architecture

### Startup order — critical constraint

`server.js` uses an async `main()` because `sql.js` (WebAssembly SQLite) requires async initialization. Routes are `require()`d **inside** `main()`, **after** `await db.initDatabase()`. Never move route imports to the top of the file — the DB proxy will throw if accessed before init.

### Database (`db.js`)

Uses `sql.js` (pure WASM, no native build). `db.js` exports a **Proxy** that delegates to a `DbWrapper` instance once `initDatabase()` has been called. The wrapper provides a `better-sqlite3`-compatible synchronous API:

```js
db.prepare('SELECT * FROM packages').all()          // → array of rows
db.prepare('SELECT * FROM packages WHERE id=?').get(id)  // → one row or undefined
db.prepare('INSERT INTO ... VALUES (?,?)').run(a, b) // → { changes, lastInsertRowid }
db.transaction(() => { /* multiple runs */ })()      // → auto BEGIN/COMMIT, saves once
```

The database file lives at `data/eazyconnect.db`. Every write calls `_flush()`, which exports the in-memory WASM database to disk. Writes inside a transaction defer the flush until COMMIT.

### Services

- **`services/voucher.js`** — all voucher lifecycle logic: code generation (format `XXXX-XXXX`, safe alphabet avoiding 0/O/1/I/L/S), batch creation, activation (ties a voucher to a MAC address and sets `expires_at`), and expiry marking.
- **`services/mikrotik.js`** — pure TCP client for the RouterOS API (port 8728). Encodes sentences using the RouterOS length-prefixed word protocol. Exports `getMikroTik(settings)` which returns a singleton connection; call `resetConnection()` after saving new settings. All RouterOS calls are optional — routes catch errors and fall back to **standalone mode** (validation only, no network enforcement).
- **`services/scheduler.js`** — `node-cron` job running every minute to call `expireOldVouchers()`.

### Routes

- **`routes/api.js`** — all admin REST endpoints under `/api/*`. Protected by `requireAdmin` middleware that checks `Authorization: Bearer <ADMIN_PASSWORD>`. The `/api/auth` POST is the only public endpoint (returns the password as the token).
- **`routes/portal.js`** — captive portal endpoints under `/portal/*`. `POST /portal/login` validates the voucher, optionally calls MikroTik to add a hotspot user, then returns a `loginUrl` pointing to MikroTik's own login page so the router grants actual network access.

### HTML pages (vanilla JS, no build step)

| Page | Route | Purpose |
|------|-------|---------|
| `public/landing/index.html` | `/` | Public marketing site with pricing and coverage info |
| `public/admin/index.html` | `/admin` | SPA admin dashboard; fetches all data from `/api/*` using `localStorage`-stored token |
| `public/portal/index.html` | `/portal` | Captive portal shown to WiFi users; reads `?mac=`, `?ip=`, `?url=` query params set by MikroTik |
| `public/print/index.html` | `/print/:batchId` | Fetches batch from `/api/batches/:id` and renders printable voucher cards |

### MikroTik integration flow

When MikroTik is configured and reachable, `POST /portal/login`:
1. Validates voucher in SQLite
2. Calls `/ip/hotspot/user/add` on the router with the voucher code as both username and password, using the package's `mikrotik_profile` (e.g. `ek-24h`)
3. Returns `loginUrl = http://<mikrotik>/login?username=<code>&password=<code>&dst=<originalUrl>`
4. The browser follows that URL, MikroTik authenticates and enforces the session timeout

MikroTik hotspot profiles (`ek-1h` through `ek-7d`) must exist on the router before use — create them via the admin dashboard **Paramètres → Créer profils hotspot** or the `POST /api/mikrotik/setup-profiles` endpoint.

## Environment variables (`.env`)

```
PORT=3000
ADMIN_PASSWORD=eazykonnect2026
MIKROTIK_HOST=192.168.88.1
MIKROTIK_PORT=8728
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=
SERVER_IP=192.168.88.10   # This machine's LAN IP, used in MikroTik redirect URL
```

Settings stored in the `settings` table override env vars for MikroTik connection params.

## Voucher status lifecycle

`unused` → `active` (on first portal login) → `expired` (automatic via scheduler or explicit check) or `cancelled` (admin-only, only from `unused`).

Vouchers in `active` status with `expires_at` in the past are bulk-updated to `expired` by the scheduler every minute and also lazily on read in `activateVoucher()` and `/portal/status`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Growth/customer acquisition, GTM, launch strategy, marketing → invoke /growth-playbook
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
