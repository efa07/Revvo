import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, assertConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { seedDatabase } from '../src/seed.js';
import { createPaymentProvider } from '../src/providers/payment/index.js';
import { createDispenser } from '../src/providers/dispenser/index.js';

let server, base, config, provider, dispenser, orders, db, n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(20); }
  throw new Error('waitFor timed out');
}
async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function newStaff() {
  const username = `staff${++n}`;
  db.prepare('INSERT INTO users(username,password_hash,role) VALUES (?,?,?)').run(username, await hashPassword('staff-pass-123'), 'staff');
  const r = await call('POST', '/api/auth/login', { body: { username, password: 'staff-pass-123' } });
  return r.json.token;
}
const productId = (name) => db.prepare('SELECT id FROM products WHERE name=?').get(name).id;
const stock = (name) => db.prepare('SELECT s.* FROM stock s JOIN products p ON p.id=s.product_id WHERE p.name=?').get(name);
const setStock = (name, q) => db.prepare('UPDATE stock SET quantity=?, reserved=0 WHERE product_id=?').run(q, productId(name));
const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const dbOrder = (id) => db.prepare('SELECT * FROM orders WHERE id=?').get(id);

async function orderAndPay(token, items, promoCode) {
  const o = await call('POST', '/api/orders', { token, headers: { 'idempotency-key': key() }, body: { items, promoCode } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const p = await call('POST', `/api/orders/${o.json.order.id}/pay`, { token });
  assert.equal(p.status, 200);
  const txn = db.prepare('SELECT provider_txn_id FROM payments WHERE order_id=? ORDER BY id DESC').get(o.json.order.id).provider_txn_id;
  return { order: p.json.order, txn };
}

before(async () => {
  config = loadConfig({ JWT_SECRET: 'a'.repeat(40), MOCK_WEBHOOK_SECRET: 'b'.repeat(20), MOCK_DISPENSE_DELAY_MS: '0' });
  assertConfig(config);
  db = openDb(':memory:');
  await seedDatabase(db, { adminPassword: 'admin-pass-123', staffPassword: 'staff-pass-123' });
  provider = createPaymentProvider(config);
  dispenser = createDispenser(config);
  const created = createApp({ db, config, provider, dispenser });
  orders = created.orders;
  const { app } = created;
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  config.publicBaseUrl = base;
});
after(() => server.close());

test('config guard: mock providers are refused in production', () => {
  assert.throws(() => assertConfig({ ...config, nodeEnv: 'production' }), /forbidden/);
});

test('RBAC: unauthenticated 401, staff blocked from admin, admin blocked from ordering', async () => {
  assert.equal((await call('GET', '/api/products')).status, 401);
  const staff = await newStaff();
  assert.equal((await call('GET', '/api/admin/products', { token: staff })).status, 403);
  assert.equal((await call('PUT', `/api/admin/products/1/stock`, { token: staff, body: { quantity: 5 } })).status, 403);
  const admin = (await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin-pass-123' } })).json.token;
  assert.equal((await call('GET', '/api/admin/products', { token: admin })).status, 200);
  assert.equal((await call('GET', '/api/products', { token: admin })).status, 403);
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } })).status, 401);
});

test('totals are computed on the server; client prices are ignored', async () => {
  const staff = await newStaff();
  const items = [{ productId: productId('Orange juice'), quantity: 1 }, { productId: productId('Potato chips'), quantity: 1 }];
  const q = await call('POST', '/api/quote', { token: staff, body: { items } });
  assert.deepEqual([q.json.subtotal, q.json.offerSavings, q.json.total], [14000, 800, 13200]);
  const q2 = await call('POST', '/api/quote', { token: staff, body: { items, promoCode: 'save10' } });
  assert.equal(q2.json.total, 12200);
  const tampered = await call('POST', '/api/quote', { token: staff, body: { items: [{ productId: 1, quantity: 1, price: 1 }] } });
  assert.equal(tampered.status, 200); // unknown field is ignored, never trusted
  assert.equal((await call('POST', '/api/quote', { token: staff, body: { items: [{ productId: 1, quantity: 99 }] } })).status, 400);
});

test('happy path: idempotent order, one vend, stock consumed only after delivery, duplicate webhook is a no-op', async () => {
  setStock('Orange juice', 3); setStock('Potato chips', 3);
  const staff = await newStaff();
  const k = key();
  const items = [{ productId: productId('Orange juice'), quantity: 1 }, { productId: productId('Potato chips'), quantity: 1 }];
  const a = await call('POST', '/api/orders', { token: staff, headers: { 'idempotency-key': k }, body: { items, promoCode: 'SAVE10' } });
  const b = await call('POST', '/api/orders', { token: staff, headers: { 'idempotency-key': k }, body: { items, promoCode: 'SAVE10' } });
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(a.json.order.id, b.json.order.id); // no double reservation
  assert.deepEqual([stock('Orange juice').quantity, stock('Orange juice').reserved], [3, 1]);
  const reuse = await call('POST', '/api/orders', { token: staff, headers: { 'idempotency-key': k }, body: { items: [{ productId: items[0].productId, quantity: 2 }] } });
  assert.equal(reuse.status, 422);

  const id = a.json.order.id;
  const p1 = await call('POST', `/api/orders/${id}/pay`, { token: staff });
  const p2 = await call('POST', `/api/orders/${id}/pay`, { token: staff });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments WHERE order_id=?').get(id).c, 1); // retry returns the same attempt
  assert.equal(p1.json.order.checkoutUrl, p2.json.order.checkoutUrl);
  assert.ok(p1.json.order.checkoutUrl.includes('/mock/pay/'));
  assert.equal(p1.json.order.total, 12200);

  const callsBefore = dispenser.calls.length;
  const txn = db.prepare('SELECT provider_txn_id t FROM payments WHERE order_id=?').get(id).t;
  await provider.emit(txn, 'SUCCEEDED', { eventId: 'same-event' });
  await provider.emit(txn, 'SUCCEEDED', { eventId: 'same-event' }); // duplicate
  await provider.emit(txn, 'SUCCEEDED'); // replay with a new event id
  await waitFor(() => dbOrder(id).dispense_status === 'DELIVERED');
  await sleep(100);
  assert.equal(dispenser.calls.length - callsBefore, 2); // exactly one vend per unit
  assert.deepEqual([stock('Orange juice').quantity, stock('Orange juice').reserved], [2, 0]);
  const view = (await call('GET', `/api/orders/${id}`, { token: staff })).json.order;
  assert.equal(view.paymentStatus, 'PAID');
  assert.ok(view.items.every((i) => i.status === 'DELIVERED'));
});

test('forged webhook is rejected; wrong amount never authorizes a vend', async () => {
  setStock('Water', 5);
  const staff = await newStaff();
  const { order, txn } = await orderAndPay(staff, [{ productId: productId('Water'), quantity: 1 }]);
  const forged = await call('POST', '/api/webhooks/payment', { headers: { 'x-mock-signature': 'ab'.repeat(32) }, body: { txnId: txn, status: 'COMPLETED', amount: '35.00', currency: 'ETB' } });
  assert.equal(forged.status, 401);
  await provider.emit(txn, 'SUCCEEDED', { amount: '1.00' }); // authentic but wrong amount
  await sleep(100);
  assert.equal(dbOrder(order.id).payment_status, 'PENDING');
  assert.equal(dbOrder(order.id).dispense_status, 'NOT_STARTED');
  await provider.emit(txn, 'SUCCEEDED', { currency: 'USD' });
  await sleep(100);
  assert.equal(dbOrder(order.id).payment_status, 'PENDING');
  await provider.emit(txn, 'SUCCEEDED');
  await waitFor(() => dbOrder(order.id).dispense_status === 'DELIVERED');
});

test('declined payment: nothing dispensed, stock held, retry uses a NEW provider transaction id', async () => {
  setStock('Cola', 4);
  const staff = await newStaff();
  const { order, txn } = await orderAndPay(staff, [{ productId: productId('Cola'), quantity: 1 }]);
  await provider.emit(txn, 'FAILED');
  await waitFor(() => dbOrder(order.id).payment_status === 'FAILED');
  assert.equal(dbOrder(order.id).dispense_status, 'NOT_STARTED');
  assert.deepEqual([stock('Cola').quantity, stock('Cola').reserved], [4, 1]);
  const again = await call('POST', `/api/orders/${order.id}/pay`, { token: staff });
  assert.equal(again.json.order.paymentStatus, 'PENDING');
  const txns = db.prepare('SELECT provider_txn_id FROM payments WHERE order_id=? ORDER BY id').all(order.id).map((r) => r.provider_txn_id);
  assert.equal(new Set(txns).size, 2);
  await provider.emit(txns[1], 'CANCELLED');
  await waitFor(() => dbOrder(order.id).payment_status === 'CANCELLED');
  const c = await call('POST', `/api/orders/${order.id}/cancel`, { token: staff });
  assert.equal(c.status, 200);
  assert.equal(stock('Cola').reserved, 0); // released only after the payment was known not to have succeeded
});

test('partial delivery: delivered unit consumed, failed unit released, order flagged for review', async () => {
  setStock('Orange juice', 5); setStock('Milk chocolate', 5);
  config.mock.dispenseScenario = 'fail-second';
  try {
    const staff = await newStaff();
    const { order, txn } = await orderAndPay(staff, [{ productId: productId('Orange juice'), quantity: 1 }, { productId: productId('Milk chocolate'), quantity: 1 }]);
    await provider.emit(txn, 'SUCCEEDED');
    await waitFor(() => dbOrder(order.id).dispense_status === 'PARTIAL');
    assert.equal(dbOrder(order.id).needs_review, 1);
    assert.deepEqual([stock('Orange juice').quantity, stock('Orange juice').reserved], [4, 0]);
    assert.deepEqual([stock('Milk chocolate').quantity, stock('Milk chocolate').reserved], [5, 0]);
  } finally { config.mock.dispenseScenario = 'ok'; }
});

test('lost acknowledgement: outcome UNKNOWN, stock stays reserved, no automatic second vend', async () => {
  setStock('Water', 5);
  config.mock.dispenseScenario = 'lost-ack';
  try {
    const staff = await newStaff();
    const before = dispenser.calls.length;
    const { order, txn } = await orderAndPay(staff, [{ productId: productId('Water'), quantity: 2 }]);
    await provider.emit(txn, 'SUCCEEDED');
    await waitFor(() => dbOrder(order.id).dispense_status === 'UNKNOWN');
    await sleep(100);
    assert.equal(dispenser.calls.length - before, 1); // stopped after the ambiguous unit
    assert.deepEqual([stock('Water').quantity, stock('Water').reserved], [5, 1]);
    await orders.reconcile();
    assert.equal(dispenser.calls.length - before, 1); // reconcile never re-sends
    const item = db.prepare('SELECT * FROM order_items WHERE order_id=?').get(order.id);
    assert.deepEqual([item.delivered_qty, item.unknown_qty, item.failed_qty], [0, 1, 1]);
  } finally { config.mock.dispenseScenario = 'ok'; }
});

test('last unit: two concurrent customers cannot both reserve it', async () => {
  setStock('Biscuits', 1);
  const [a, b] = await Promise.all([newStaff(), newStaff()]);
  const mk = (t) => call('POST', '/api/orders', { token: t, headers: { 'idempotency-key': key() }, body: { items: [{ productId: productId('Biscuits'), quantity: 1 }] } });
  const results = await Promise.all([mk(a), mk(b)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(stock('Biscuits').reserved, 1);
});

test('unknown payment (window expired) keeps stock held, blocks a second order, and still recovers on late success', async () => {
  setStock('Cola', 4);
  const staff = await newStaff();
  const { order, txn } = await orderAndPay(staff, [{ productId: productId('Cola'), quantity: 1 }]);
  config.paymentWindowSeconds = 0;
  try { await orders.reconcile(); } finally { config.paymentWindowSeconds = 600; }
  assert.equal(dbOrder(order.id).payment_status, 'UNKNOWN');
  assert.equal(stock('Cola').reserved, 1);
  const blocked = await call('POST', '/api/orders', { token: staff, headers: { 'idempotency-key': key() }, body: { items: [{ productId: productId('Water'), quantity: 1 }] } });
  assert.equal(blocked.status, 409); assert.equal(blocked.json.error.code, 'UNRESOLVED_ORDER');
  const active = await call('GET', '/api/orders/active', { token: staff });
  assert.equal(active.json.order.id, order.id); // app can resume after restart
  await provider.emit(txn, 'SUCCEEDED');
  await waitFor(() => dbOrder(order.id).dispense_status === 'DELIVERED');
});

test('lost webhook is recovered by the status lookup (reconcile)', async () => {
  setStock('Cola', 4);
  const staff = await newStaff();
  const { order, txn } = await orderAndPay(staff, [{ productId: productId('Cola'), quantity: 1 }]);
  provider.get(txn).status = 'SUCCEEDED'; // provider says paid; the webhook never arrived
  db.prepare('UPDATE payments SET created_at=? WHERE provider_txn_id=?').run(new Date(Date.now() - 60_000).toISOString(), txn);
  await orders.reconcile();
  await waitFor(() => dbOrder(order.id).dispense_status === 'DELIVERED');
});

test('maintenance mode blocks new orders', async () => {
  const admin = (await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin-pass-123' } })).json.token;
  const staff = await newStaff();
  await call('PATCH', '/api/admin/machine', { token: admin, body: { status: 'MAINTENANCE' } });
  const r = await call('POST', '/api/orders', { token: staff, headers: { 'idempotency-key': key() }, body: { items: [{ productId: productId('Water'), quantity: 1 }] } });
  assert.equal(r.status, 503);
  await call('PATCH', '/api/admin/machine', { token: admin, body: { status: 'ACTIVE' } });
});

test('restart recovery: an order caught mid-dispense is finalized as UNKNOWN, never re-sent', async () => {
  setStock('Water', 5);
  const staff = await newStaff();
  const { order } = await orderAndPay(staff, [{ productId: productId('Water'), quantity: 1 }]);
  db.prepare(`UPDATE orders SET payment_status='PAID', dispense_status='DISPENSING' WHERE id=?`).run(order.id);
  db.prepare('UPDATE order_items SET unknown_qty=1 WHERE order_id=?').run(order.id); // crash happened after the in-doubt marker
  const before = dispenser.calls.length;
  orders.recoverOnBoot();
  assert.equal(dbOrder(order.id).dispense_status, 'UNKNOWN');
  assert.equal(dispenser.calls.length, before);
  db.prepare(`UPDATE payments SET status='SUCCEEDED' WHERE order_id=?`).run(order.id);
});
