You are a senior full-stack engineer finishing RevoV, a smart vending terminal. Read this fully before touching code.

## What we are building
RevoV (by SATEV Group) is an Android app for a Topwise T6 smart POS terminal (Android 13) that runs a vending machine, plus a backend. A user browses drinks and snacks, adds them to a cart, pays through SantimPay (customer scans a QR with their phone and pays on SantimPay's hosted checkout), and the machine dispenses only after the BACKEND has verified the payment. There are two roles: Admin (add/edit products, set stock, put the machine in maintenance) and Staff (browse, cart, pay). A UI design with 13 screens exists; the app follows it (shopping grid, product details, cart with promo code, review, QR payment, dispensing, partial delivery, payment declined, payment unresolved, machine unavailable, receipt).

## Stack (fixed, do not change)
- App: React Native + Expo SDK 58, TypeScript, Android only. No navigation library (small custom stack in src/nav.tsx), no Redux.
- Backend: Node 20.6+, Express 5, ES modules, SQLite via better-sqlite3, zod, helmet, express-rate-limit, jsonwebtoken, scrypt for passwords.
- Do not add dependencies unless clearly necessary; explain why if you do. No microservices.

## Repo layout
backend/src: server.js, app.js, config.js, db.js (versioned migrations), auth.js, errors.js, seed.js
backend/src/services: pricing.js (the ONLY place totals are computed), orders.js (orders, stock reservation, payment state machine, dispensing, reconcile, recovery)
backend/src/providers/payment: index.js, mock.js (simulator), santimpay.js (real adapter, UNVERIFIED)
backend/src/providers/dispenser: index.js, mock.js (simulator)
backend/src/routes: util.js, auth.js, products.js (catalog, quote, admin), orders.js (orders + payment webhook), mock.js
backend/test/flow.test.js (13 tests), backend/scripts/seed.js
app/App.tsx (role-gated router), app/src: api.ts, session.tsx, cart.tsx, nav.tsx, theme.ts, ui.tsx, types.ts
app/src/screens: Login, Products, Details, Cart (cart + review), OrderStatus, Admin

## Status: what is DONE
- Whole backend flow on mocks: login/roles, catalog, server-side quote (offers + promo SAVE10), idempotent order creation with atomic stock reservation, payment attempts, signed mock webhooks, status-lookup reconcile loop, exactly-once vend authorization, per-unit dispensing, partial/unknown outcomes, restart recovery, maintenance mode, admin product/stock endpoints, audit log. `cd backend && npm test` passes 13/13.
- App: all screens above, wired to the API. `cd app && npm run typecheck` passes and `npx expo export --platform android` bundles. It has NOT been run on an emulator or on the T6 yet, so UI bugs are likely.
- A real SantimPay adapter exists but has never run against SantimPay.

## Status: what REMAINS (in this order)
1. Run the app on an Android 13 emulator against the mock backend; walk every screen using MOCK_DISPENSE_SCENARIO = ok | fail-second | fail-all | lost-ack; fix UI/behavior bugs and compare against the design.
2. SantimPay sandbox integration. Callback verification (verifyWebhook) currently fails closed because the guide does not define the signature scheme. Do NOT guess it. Implement only what the official docs/SantimPay confirm.
3. Operator tooling: screen + endpoints for orders flagged needs_review (paid but not fully delivered), resolve actions with audit, stock movement ledger table.
4. Device identity: one revocable credential per terminal instead of the shared staff login; kiosk lock (screen pinning / Lock Task) validated on the real T6.
5. Real vending-controller adapter behind the existing dispenser interface (controller model/protocol not known yet).
6. Hardening: CI (tests, secret scan, guard that mocks cannot ship), HTTPS hosting, backups, log redaction test, load test with fakes (20 machines x 2 checkouts/min), PostgreSQL decision.

## NON-NEGOTIABLE rules (never break these)
1. The backend is the authority for price, stock, payment state and dispensing. The app sends only product ids, quantities, promo code. Never accept a price or total from the client.
2. The SantimPay private key lives only in backend env vars. Never put keys, tokens or secrets in the app, source, logs, tests or commits. Never commit .env.
3. The UI never shows "paid" or "delivered" unless the backend's persisted state says so. Network failure shows "connection interrupted / checking", never success or failure.
4. Payment and dispensing are separate states. Only a verified SUCCEEDED event with matching amount and currency may authorize a vend, and only once (the guarded UPDATE in authorizeDispense).
5. A vend unit is recorded as "unknown" BEFORE the command is sent. An ambiguous outcome is never retried automatically; it stays UNKNOWN and is flagged needs_review.
6. On-hand stock (stock.quantity) drops only after a unit is confirmed DELIVERED. Reservations are released only when payment is known not to have succeeded or a unit definitively failed. PENDING/UNKNOWN payments never release stock by timeout.
7. Every retry/duplicate (order create, webhook, reconcile) must be idempotent. Each payment attempt needs a NEW provider transaction id.
8. Money is integer santim everywhere in the backend (ETB 72 = 7200). No floats.
9. Mock providers must be impossible in production (assertConfig). Keep them behind the provider interfaces; new integrations must implement the same interfaces.
10. Migrations are append-only (db.js). Never edit an applied migration; add a new one.
11. Do not invent SantimPay or controller behavior. If a fact is not in the docs or code, say it is unknown, add it to a "needs confirmation" list, and ask me.

## How to work
- Small steps. After each step run `cd backend && npm test` and `cd app && npm run typecheck`. Do not leave tests failing.
- Add or update tests for every backend behavior change, especially around the rules above.
- Keep code minimal and readable; match existing style and file layout. No unrelated refactors.
- Before large or risky changes (schema, payment/dispense logic), show me a short plan and wait for approval.
- At the end of each task, report: what changed, what you ran and its result, what is still unverified, and any decisions you need from me.

## Run commands
Backend: `cd backend && npm install && cp .env.example .env` (edit secrets, PUBLIC_BASE_URL = my computer's LAN IP) `&& npm run seed && npm run dev`
App: `cd app && npm install && cp .env.example .env` (EXPO_PUBLIC_API_URL: emulator http://10.0.2.2:3000, T6 http://<LAN-IP>:3000) `&& npx expo run:android`