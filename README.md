# RevoV – vending terminal starter (Expo + Express)

A working starting point for the RevoV customer terminal (Topwise T6, Android 13) and its backend.
Payment and dispensing are **mocked behind interfaces**; the real SantimPay adapter is written from the V1.3 guide but **unverified**.

## 1. Database: SQLite (via `better-sqlite3`)
Zero setup, one file, real transactions, and synchronous writes make the "reserve stock atomically" and "claim the vend exactly once" rules simple and testable. It fits a pilot (one backend, low volume). All SQL lives in `db.js`, `services/` and `routes/`, so moving to PostgreSQL later is a mechanical change. Do not host it on an ephemeral disk, and plan the move before running many machines against one backend.

## 2. Structure
```
backend/
  src/server.js            boot: config guard, DB, recovery, reconcile timer
  src/app.js               Express wiring, helmet, error handler
  src/config.js            env -> config; assertConfig() refuses unsafe setups (mocks in production)
  src/db.js                schema (versioned migrations), settings, audit helper
  src/auth.js              scrypt password hashing, JWT, authenticate + requireRole
  src/seed.js              dummy products/stock/users/promo
  src/services/pricing.js  the ONLY place totals are computed
  src/services/orders.js   orders, reservations, payment state machine, dispensing, reconcile, recovery
  src/providers/payment/   mock.js (simulator), santimpay.js (unverified), index.js
  src/providers/dispenser/ mock.js (simulator), index.js
  src/routes/              auth, products(+admin), orders(+webhook), mock checkout page
  scripts/seed.js          npm run seed
  test/flow.test.js        13 tests of the money/stock rules
app/
  App.tsx                  providers + role-gated router
  src/api.ts session.tsx cart.tsx nav.tsx theme.ts ui.tsx types.ts
  src/screens/             Login, Products, Details, Cart (+Review), OrderStatus, Admin
```

## 3. Run the backend
Requires Node 20.6+.
```bash
cd backend
npm install
cp .env.example .env      # then edit: JWT_SECRET, MOCK_WEBHOOK_SECRET, SEED_*_PASSWORD, PUBLIC_BASE_URL
npm run seed              # users admin + staff, 6 products, promo SAVE10
npm run dev               # http://localhost:3000   (npm test runs the test suite)
```
**PUBLIC_BASE_URL** must be an address your phone can open (your computer's LAN IP, e.g. `http://192.168.1.20:3000`). The QR on the payment screen encodes a link under this address.

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | ≥32 random chars. Server refuses to start otherwise |
| `PAYMENT_PROVIDER` | `mock` (default) or `santimpay`. `mock` is refused when `NODE_ENV=production` |
| `MOCK_WEBHOOK_SECRET` | signs the mock provider's callbacks |
| `MOCK_DISPENSE_SCENARIO` | `ok`, `fail-second` (partial delivery), `fail-all`, `lost-ack` (unknown outcome) |
| `PAYMENT_WINDOW_SECONDS` | no answer after this → payment becomes UNKNOWN (stock stays held) |
| `UNPAID_HOLD_SECONDS` | idle time before stock held by an unpaid order is returned |
| `SANTIMPAY_BASE_URL / MERCHANT_ID / PRIVATE_KEY` | real provider, backend only, empty while mocking |
| `MACHINE_ID` | shown on screens and receipts |

## 4. Run the app (emulator or T6)
```bash
cd app
npm install
cp .env.example .env      # set EXPO_PUBLIC_API_URL for the target below
npx expo run:android      # builds a development APK and installs it on the emulator/USB device
npm run typecheck
```
- **Emulator:** Android Studio AVD on API 33 (Android 13), then run the command above.
- **T6 over USB:** enable Developer options + USB debugging, connect over USB (`adb devices` must list it), set `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000`, then run `adb reverse tcp:3000 tcp:3000` before installing/running the app. Repeat the reverse command after reconnecting the device. This forwards the device's localhost port to the computer's backend; it does not make QR checkout links reachable from the customer's phone.
- **T6 over Wi-Fi:** set `EXPO_PUBLIC_API_URL=http://<computer-LAN-IP>:3000` and ensure the terminal and computer can reach each other on the network.
- A POS terminal usually has no Play Store, so use this development build, not Expo Go.
- **Test a payment (mock):** add items → Review → Pay. Scan the QR with a phone on the same Wi-Fi and press *approve* / *decline* / *cancel*. In dev builds there is also a "DEV: open checkout page" button.
- **Production build:** set `APP_ENV=production` and an `https://` `EXPO_PUBLIC_API_URL`, then build a signed release APK/AAB with your own keystore. `APP_ENV=production` turns off cleartext HTTP.
- Logins come from the seed values you put in `.env` (usernames `admin` and `staff`). Admin sees the admin screen only; staff see the shop only.

## 5. How the safety rules are implemented
- **Server is authoritative.** The app sends product ids + quantities + promo code. `pricing.js` computes subtotal, offers, promo and total; totals shown in the app come from `/api/quote`.
- **Idempotent orders.** `POST /api/orders` requires an `Idempotency-Key`. Same key + same body → same order; same key + different body → 422.
- **Reservation, not decrement.** Stock has `quantity` (physically inside) and `reserved`. Creating an order reserves atomically (last unit cannot be sold twice). `quantity` drops only when the dispenser confirms a unit as delivered.
- **Payment and dispensing are separate states.** Only a verified SUCCEEDED event with matching amount/currency marks the order PAID; the vend is authorized in the same transaction (`DISPENSING` claimed with a guarded UPDATE), so duplicate or replayed events cannot start a second vend.
- **Unknown stays unknown.** Timeout/lookup failure → UNKNOWN; stock stays held, new orders for that user are blocked, and the app resumes the order after a restart. A late success is still honoured.
- **Ambiguous dispense is never retried.** A unit is marked "in doubt" *before* the command is sent. Lost acknowledgement or a crash leaves it UNKNOWN and flags the order for an operator.
- **Webhooks:** raw-body signature check, dedupe table, always 200 once authentic. SantimPay callbacks are rejected until their signature scheme is confirmed; the reconcile loop (status lookup every 10 s) is what confirms payments meanwhile.
- **Secrets:** the private key exists only in backend env vars; the app has no key and no provider code.

## 6. Assumptions about SantimPay to verify (from the V1.3 guide)
1. Base URL / sandbox URL: the guide gives `https://services.santimpay.com/api/v1/gateway/...` but says test and production URLs are shared separately. `SANTIMPAY_BASE_URL` should end at `/api/v1/gateway`.
2. **Callback authentication is undefined** in the guide ("signedToken in the request header"): header name, claims, body binding. `verifyWebhook` fails closed until you implement it.
3. Which callback field carries *our* transaction id (`txnId`, `refId`, `thirdPartyId`?). Needed before webhooks can be matched.
4. Status strings: only `COMPLETED` is documented for C2B. `FAILED`, `CANCELLED`, `PENDING` are guesses; anything else maps to UNKNOWN.
5. The status lookup response has **no amount or currency**, so the amount check is only possible on callbacks. Decide whether that is acceptable or ask SantimPay.
6. `amount` is sent as decimal ETB; no currency field exists in requests (ETB assumed).
7. Ambiguous initiate results (timeout, 5xx, 409 "txn id already in use") keep the attempt PENDING and rely on lookup. Confirm what lookup returns for a transaction the customer never opened ("record not found"?).
8. Hosted checkout opened from a phone via QR (not a WebView on the terminal) and `phoneNumber` omitted. Confirm both are allowed.
9. Whether the sandbox charges money, and how test keys differ from live keys.
10. Refunds: the guide has a payout API but no refund-of-transaction API. No refund is executed automatically.

## 7. Replace later
| Now | Replace with |
|---|---|
| `providers/payment/mock.js` + `/mock/*` routes | Finish and sandbox-test `santimpay.js` (items above) |
| `providers/dispenser/mock.js` | Real controller adapter honouring the contract in that file (stable `commandId`, FAILED only when proven, otherwise UNKNOWN). `assertConfig` currently rejects any other `DISPENSER` value, so update it too |
| Product `slot` column | Real machine channel mapping |
| Emoji thumbnails | Product images (`image_url` already supported, https only) |
| Single shared staff account | Per-terminal credentials and revocation; kiosk lock (screen pinning / Lock Task) validated on the T6; T6 SDK only if needed |
| Admin has no order screen | An operator view for orders flagged `needs_review` (paid, not fully delivered) and a refund/resolve action |
| SQLite | PostgreSQL if you scale beyond a pilot |

## 8. Deliberately left out
Language selector, the "receipt on your phone" QR (the design marks it as demo), ingredients/nutrition/allergen data (screen shows "Information not available"), push notifications, analytics, refunds.
Sold-out items are shown greyed out (as in your design) instead of hidden; the stock numbers themselves are never sent to staff.
# Revvo
