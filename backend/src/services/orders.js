import crypto from 'node:crypto';
import { HttpError } from '../errors.js';
import { audit as auditRow, getSetting } from '../db.js';
import { buildQuote, mergeItems } from './pricing.js';

const nowIso = () => new Date().toISOString();
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
export const orderRef = (id) => `RV-${10000 + id}`;

/**
 * Order lifecycle. Four independent dimensions are kept apart on purpose:
 *   stock reservation  -> order_items.reserved_qty / stock.reserved
 *   payment attempt    -> payments.status  (PENDING | SUCCEEDED | FAILED | CANCELLED | UNKNOWN)
 *   order payment      -> orders.payment_status (UNPAID | PENDING | PAID | FAILED | CANCELLED | UNKNOWN)
 *   dispensing         -> orders.dispense_status + per-unit counters on order_items
 * Every state change is a single SQLite transaction (better-sqlite3 is synchronous, so each is atomic).
 */
export function createOrderService({ db, config, provider, dispenser }) {
  const audit = (actor, action, target, detail) => auditRow(db, actor, action, target, detail);
  const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  const getItems = (id) => db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id);
  const latestPayment = (id) => db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1').get(id);
  const machineActive = () => getSetting(db, 'machine_status') === 'ACTIVE';

  // ---------- views ----------
  function itemStatus(o, i) {
    if (i.delivered_qty === i.quantity) return 'DELIVERED';
    if (i.unknown_qty > 0) return 'UNKNOWN';
    if (i.failed_qty > 0) return 'FAILED';
    if (o.dispense_status === 'DISPENSING') return 'DISPENSING';
    if (['PARTIAL', 'FAILED', 'UNKNOWN'].includes(o.dispense_status)) return 'FAILED';
    return 'PENDING';
  }

  function view(orderId) {
    const o = getOrder(orderId);
    if (!o) return null;
    const pay = latestPayment(orderId);
    return {
      id: o.id,
      reference: orderRef(o.id),
      machineId: o.machine_id,
      createdAt: o.created_at,
      items: db.prepare('SELECT oi.*, p.category FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? ORDER BY oi.id').all(orderId).map((i) => ({
        productId: i.product_id, category: i.category, name: i.name, sizeLabel: i.size_label, unitPrice: i.unit_price_minor,
        listPrice: i.list_price_minor, quantity: i.quantity, delivered: i.delivered_qty, status: itemStatus(o, i),
      })),
      subtotal: o.subtotal_minor, offerSavings: o.offer_savings_minor, promoCode: o.promo_code,
      promoDiscount: o.promo_discount_minor, total: o.total_minor, currency: o.currency,
      paymentStatus: o.payment_status,
      dispenseStatus: o.dispense_status,
      checkoutUrl: o.payment_status === 'PENDING' ? pay?.checkout_url ?? null : null,
    };
  }

  function getOrderFor(user, id) {
    const o = getOrder(id);
    if (!o || (user.role !== 'admin' && o.user_id !== user.id)) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    return view(id);
  }

  const activeOrderFor = (user) => {
    const row = db.prepare(
      `SELECT id FROM orders WHERE user_id=? AND (payment_status IN ('PENDING','UNKNOWN') OR dispense_status='DISPENSING') ORDER BY id DESC LIMIT 1`,
    ).get(user.id);
    return row ? view(row.id) : null;
  };

  // ---------- stock reservation (call only inside a transaction) ----------
  function releaseReservation(orderId) {
    for (const i of getItems(orderId)) {
      if (i.reserved_qty > 0) {
        db.prepare('UPDATE stock SET reserved = reserved - ? WHERE product_id=?').run(i.reserved_qty, i.product_id);
        db.prepare('UPDATE order_items SET reserved_qty = 0 WHERE id=?').run(i.id);
      }
    }
  }

  /** Re-acquire any units that were released (idle hold expired) or never held. Check everything first, then apply. */
  function ensureReserved(orderId) {
    const needs = getItems(orderId)
      .map((i) => ({ i, deficit: i.quantity - i.delivered_qty - i.failed_qty - i.unknown_qty - i.reserved_qty }))
      .filter((n) => n.deficit > 0);
    for (const { i, deficit } of needs) {
      const s = db.prepare('SELECT quantity, reserved FROM stock WHERE product_id=?').get(i.product_id);
      if (!s || s.quantity - s.reserved < deficit) throw new HttpError(409, 'OUT_OF_STOCK', `${i.name} is no longer available`, { productId: i.product_id });
    }
    for (const { i, deficit } of needs) {
      db.prepare('UPDATE stock SET reserved = reserved + ? WHERE product_id=?').run(deficit, i.product_id);
      db.prepare('UPDATE order_items SET reserved_qty = reserved_qty + ? WHERE id=?').run(deficit, i.id);
    }
  }

  // ---------- create order (idempotent) ----------
  function createOrder({ user, idemKey, items, promoCode }) {
    const merged = mergeItems(items).sort((a, b) => a.productId - b.productId);
    const hash = crypto.createHash('sha256').update(JSON.stringify({ merged, promo: promoCode?.trim().toUpperCase() ?? null })).digest('hex');

    const tx = db.transaction(() => {
      const existing = db.prepare('SELECT id, request_hash FROM orders WHERE user_id=? AND idempotency_key=?').get(user.id, idemKey);
      if (existing) {
        if (existing.request_hash !== hash) throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This key was already used for a different order');
        return { id: existing.id, replay: true };
      }
      if (!machineActive()) throw new HttpError(503, 'MACHINE_UNAVAILABLE', 'This machine cannot take new orders right now');

      // A payment still being checked (or items still dispensing) blocks a new order: prevents double paying.
      const blocking = db.prepare(
        `SELECT id FROM orders WHERE user_id=? AND (payment_status IN ('PENDING','UNKNOWN') OR dispense_status='DISPENSING') LIMIT 1`,
      ).get(user.id);
      if (blocking) throw new HttpError(409, 'UNRESOLVED_ORDER', 'An earlier order is still being processed', { orderId: blocking.id });

      // Abandoned, never-paid orders of this user give their stock back so it is available to this quote.
      for (const o of db.prepare(`SELECT id FROM orders WHERE user_id=? AND payment_status IN ('UNPAID','FAILED','CANCELLED')`).all(user.id)) {
        releaseReservation(o.id);
      }

      const q = buildQuote(db, merged, promoCode);
      const info = db.prepare(
        `INSERT INTO orders(user_id,machine_id,idempotency_key,request_hash,subtotal_minor,offer_savings_minor,promo_code,promo_discount_minor,total_minor,currency)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(user.id, config.machineId, idemKey, hash, q.subtotal, q.offers, q.promo, q.discount, q.total, q.currency);
      const orderId = Number(info.lastInsertRowid);
      for (const l of q.lines) {
        db.prepare(
          `INSERT INTO order_items(order_id,product_id,name,size_label,unit_price_minor,list_price_minor,quantity,reserved_qty) VALUES (?,?,?,?,?,?,?,?)`,
        ).run(orderId, l.product.id, l.product.name, l.product.size_label, l.unit, l.list, l.quantity, l.quantity);
        const r = db.prepare('UPDATE stock SET reserved = reserved + ? WHERE product_id=? AND quantity - reserved >= ?').run(l.quantity, l.product.id, l.quantity);
        if (r.changes !== 1) throw new HttpError(409, 'OUT_OF_STOCK', `${l.product.name} is not available in that quantity`); // rolls back everything
      }
      return { id: orderId, replay: false };
    });
    const { id, replay } = tx();
    return { order: view(id), replay };
  }

  // ---------- payment ----------
  async function startPayment({ user, orderId }) {
    const prepare = db.transaction(() => {
      const o = getOrder(orderId);
      if (!o || o.user_id !== user.id) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
      if (o.payment_status === 'PAID') throw new HttpError(409, 'ALREADY_PAID', 'This order is already paid');
      if (o.payment_status === 'PENDING' || o.payment_status === 'UNKNOWN') return { created: false }; // idempotent: never a second concurrent attempt
      if (o.closed) throw new HttpError(409, 'ORDER_CLOSED', 'This order was cancelled');
      if (!machineActive()) throw new HttpError(503, 'MACHINE_UNAVAILABLE', 'This machine cannot take new orders right now');
      ensureReserved(o.id);
      const attempt = db.prepare('SELECT COUNT(*) AS c FROM payments WHERE order_id=?').get(o.id).c + 1;
      const txnId = `${orderRef(o.id)}-${attempt}`; // provider needs a NEW id for every attempt
      db.prepare(`INSERT INTO payments(order_id,provider,provider_txn_id,amount_minor,currency,status) VALUES (?,?,?,?,?,'PENDING')`)
        .run(o.id, provider.name, txnId, o.total_minor, o.currency);
      db.prepare(`UPDATE orders SET payment_status='PENDING', updated_at=? WHERE id=?`).run(nowIso(), o.id);
      return { created: true, txnId, amountMinor: o.total_minor, currency: o.currency };
    });
    const r = prepare();
    if (r.created) {
      try {
        const { checkoutUrl } = await provider.initiate({
          txnId: r.txnId, amountMinor: r.amountMinor, currency: r.currency,
          reason: `RevoV order ${orderRef(orderId)}`, notifyUrl: `${config.publicBaseUrl}/api/webhooks/payment`,
        });
        db.prepare('UPDATE payments SET checkout_url=?, updated_at=? WHERE provider_txn_id=?').run(checkoutUrl, nowIso(), r.txnId);
      } catch (err) {
        if (err.definite) {
          applyProviderEvent({ txnId: r.txnId, status: 'FAILED', rawStatus: `INITIATE_${err.status ?? 'REJECTED'}`, source: 'initiate' });
        } else {
          // We cannot know if the provider created the payment. Stay PENDING; the reconcile loop looks it up.
          audit('system', 'PAYMENT_INITIATE_AMBIGUOUS', r.txnId, { message: err.message });
        }
      }
    }
    return view(orderId);
  }

  function cancelOrder({ user, orderId }) {
    db.transaction(() => {
      const o = getOrder(orderId);
      if (!o || o.user_id !== user.id) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
      if (['PENDING', 'UNKNOWN', 'PAID'].includes(o.payment_status)) {
        throw new HttpError(409, 'CANNOT_CANCEL', 'A payment is in progress or complete for this order');
      }
      releaseReservation(o.id);
      db.prepare(`UPDATE orders SET closed=1, payment_status=CASE WHEN payment_status='UNPAID' THEN 'CANCELLED' ELSE payment_status END, updated_at=? WHERE id=?`).run(nowIso(), o.id);
    })();
    return view(orderId);
  }

  /**
   * The single entry point for provider results (webhook, status lookup, timeout, initiate failure).
   * Rules: duplicates are no-ops; only SUCCEEDED for the exact amount/currency can authorize a vend;
   * a SUCCEEDED payment is terminal; late/out-of-order events cannot overwrite it.
   */
  function applyProviderEvent(ev) {
    const tx = db.transaction(() => {
      if (ev.dedupeKey) {
        const r = db.prepare('INSERT OR IGNORE INTO payment_events(dedupe_key,txn_id,payload) VALUES (?,?,?)').run(ev.dedupeKey, ev.txnId, JSON.stringify(ev.payload ?? null));
        if (r.changes === 0) return 'DUPLICATE';
      }
      const pay = db.prepare('SELECT * FROM payments WHERE provider_txn_id=?').get(ev.txnId);
      if (!pay) { audit('system', 'PAYMENT_EVENT_UNKNOWN_TXN', ev.txnId); return 'UNKNOWN_TXN'; }
      const o = getOrder(pay.order_id);
      if (ev.rawStatus) db.prepare('UPDATE payments SET raw_status=?, updated_at=? WHERE id=?').run(ev.rawStatus, nowIso(), pay.id);
      const isLatest = latestPayment(o.id).id === pay.id;

      if (ev.status === 'SUCCEEDED') {
        const mismatch = (ev.amountMinor !== undefined && ev.amountMinor !== pay.amount_minor) || (ev.currency !== undefined && ev.currency !== pay.currency);
        if (mismatch) { audit('system', 'PAYMENT_MISMATCH', pay.provider_txn_id, { expected: [pay.amount_minor, pay.currency], got: [ev.amountMinor, ev.currency] }); return 'MISMATCH'; }
        if (pay.status === 'SUCCEEDED') return 'NOOP';
        db.prepare(`UPDATE payments SET status='SUCCEEDED', updated_at=? WHERE id=?`).run(nowIso(), pay.id);
        if (o.payment_status === 'PAID') { // two attempts both paid: record it, never vend twice
          audit('system', 'DUPLICATE_PAYMENT_SUCCESS', pay.provider_txn_id, { orderId: o.id });
          db.prepare('UPDATE orders SET needs_review=1 WHERE id=?').run(o.id);
          return 'DOUBLE_PAYMENT';
        }
        db.prepare(`UPDATE orders SET payment_status='PAID', updated_at=? WHERE id=?`).run(nowIso(), o.id);
        authorizeDispense(o.id);
        return 'SUCCEEDED';
      }

      if (pay.status === 'SUCCEEDED') return 'IGNORED_AFTER_SUCCESS';

      if (ev.status === 'FAILED' || ev.status === 'CANCELLED') {
        if (pay.status === 'FAILED' || pay.status === 'CANCELLED') return 'NOOP';
        db.prepare('UPDATE payments SET status=?, updated_at=? WHERE id=?').run(ev.status, nowIso(), pay.id);
        if (isLatest && o.payment_status !== 'PAID') db.prepare('UPDATE orders SET payment_status=?, updated_at=? WHERE id=?').run(ev.status, nowIso(), o.id);
        return ev.status; // reservation is kept so "try again" works; it is released on cancel or idle expiry
      }

      if (ev.status === 'UNKNOWN' && pay.status === 'PENDING' && ev.source === 'timeout') {
        db.prepare(`UPDATE payments SET status='UNKNOWN', updated_at=? WHERE id=?`).run(nowIso(), pay.id);
        if (isLatest && o.payment_status === 'PENDING') db.prepare(`UPDATE orders SET payment_status='UNKNOWN', updated_at=? WHERE id=?`).run(nowIso(), o.id);
        return 'UNKNOWN';
      }
      return 'NOOP';
    });
    const outcome = tx();
    if (outcome === 'SUCCEEDED') {
      const pay = db.prepare('SELECT order_id FROM payments WHERE provider_txn_id=?').get(ev.txnId);
      if (getOrder(pay.order_id).dispense_status === 'DISPENSING') setImmediate(() => runDispense(pay.order_id).catch((e) => console.error('dispense error', e)));
    }
    return outcome;
  }

  // ---------- dispensing ----------
  /** Runs inside the transaction that marks the order PAID: the vend authorization is durable BEFORE any dispatch. */
  function authorizeDispense(orderId) {
    if (getOrder(orderId).closed) { // customer already cancelled and left: do not vend into an empty tray
      db.prepare(`UPDATE orders SET dispense_status='FAILED', needs_review=1, updated_at=? WHERE id=?`).run(nowIso(), orderId);
      audit('system', 'LATE_PAYMENT_ON_CLOSED_ORDER', orderId);
      return false;
    }
    try {
      ensureReserved(orderId); // late success after the hold expired: re-acquire stock or flag for an operator
    } catch {
      db.prepare(`UPDATE orders SET dispense_status='FAILED', needs_review=1, updated_at=? WHERE id=?`).run(nowIso(), orderId);
      audit('system', 'PAID_BUT_NOT_DISPENSABLE', orderId);
      return false;
    }
    const r = db.prepare(`UPDATE orders SET dispense_status='DISPENSING', updated_at=? WHERE id=? AND payment_status='PAID' AND dispense_status='NOT_STARTED'`).run(nowIso(), orderId);
    return r.changes === 1; // exactly-once claim: a replayed event cannot start a second vend
  }

  const settleUnit = db.transaction((item, outcome) => {
    if (outcome === 'DELIVERED') {
      db.prepare('UPDATE order_items SET unknown_qty=unknown_qty-1, delivered_qty=delivered_qty+1, reserved_qty=reserved_qty-1 WHERE id=?').run(item.id);
      db.prepare('UPDATE stock SET quantity=quantity-1, reserved=reserved-1 WHERE product_id=?').run(item.product_id); // the ONLY place on-hand stock drops
    } else if (outcome === 'FAILED') {
      db.prepare('UPDATE order_items SET unknown_qty=unknown_qty-1, failed_qty=failed_qty+1, reserved_qty=reserved_qty-1 WHERE id=?').run(item.id);
      db.prepare('UPDATE stock SET reserved=reserved-1 WHERE product_id=?').run(item.product_id);
    } // UNKNOWN: unit stays in doubt, stock stays reserved, never retried
  });

  const finalizeDispense = db.transaction((orderId) => {
    let delivered = 0, failed = 0, unknown = 0, total = 0;
    for (const i of getItems(orderId)) {
      const leftover = i.quantity - i.delivered_qty - i.failed_qty - i.unknown_qty; // never attempted -> definite non-delivery
      if (leftover > 0) {
        db.prepare('UPDATE order_items SET failed_qty=failed_qty+?, reserved_qty=reserved_qty-? WHERE id=?').run(leftover, leftover, i.id);
        db.prepare('UPDATE stock SET reserved=reserved-? WHERE product_id=?').run(leftover, i.product_id);
      }
      const f = db.prepare('SELECT * FROM order_items WHERE id=?').get(i.id);
      delivered += f.delivered_qty; failed += f.failed_qty; unknown += f.unknown_qty; total += f.quantity;
    }
    const status = unknown > 0 ? 'UNKNOWN' : delivered === total ? 'DELIVERED' : delivered > 0 ? 'PARTIAL' : 'FAILED';
    db.prepare(`UPDATE orders SET dispense_status=?, needs_review=CASE WHEN ?='DELIVERED' THEN needs_review ELSE 1 END, updated_at=? WHERE id=? AND dispense_status='DISPENSING'`).run(status, status, nowIso(), orderId);
    if (status !== 'DELIVERED') audit('system', 'DISPENSE_NEEDS_REVIEW', orderId, { status, delivered, failed, unknown });
    return status;
  });

  async function runDispense(orderId) {
    const o = getOrder(orderId);
    if (!o || o.dispense_status !== 'DISPENSING') return;
    let stop = false;
    for (const item of getItems(orderId)) {
      const slot = db.prepare('SELECT slot FROM products WHERE id=?').get(item.product_id)?.slot ?? null;
      let seq = item.delivered_qty + item.failed_qty + item.unknown_qty;
      while (seq < item.quantity && !stop) {
        db.prepare('UPDATE order_items SET unknown_qty=unknown_qty+1 WHERE id=?').run(item.id); // in-doubt marker persisted BEFORE dispatch
        seq += 1;
        let outcome;
        try {
          ({ outcome } = await dispenser.dispense({ commandId: `${orderRef(orderId)}-${item.id}-${seq}`, orderRef: orderRef(orderId), productId: item.product_id, slot }));
        } catch {
          outcome = 'UNKNOWN';
        }
        settleUnit(item, outcome);
        if (outcome === 'UNKNOWN') stop = true; // do not keep vending on a machine in an unknown state
      }
    }
    finalizeDispense(orderId);
  }

  // ---------- background maintenance ----------
  async function reconcile() {
    // 1. Ask the provider about open payments (covers lost or untrusted webhooks).
    for (const p of db.prepare(`SELECT provider_txn_id FROM payments WHERE status IN ('PENDING','UNKNOWN') AND created_at < ?`).all(ago(3))) {
      try {
        const r = await provider.fetchStatus(p.provider_txn_id);
        applyProviderEvent({ txnId: p.provider_txn_id, status: r.status, amountMinor: r.amountMinor, currency: r.currency, rawStatus: r.rawStatus, source: 'lookup' });
      } catch (e) {
        audit('system', 'PAYMENT_LOOKUP_FAILED', p.provider_txn_id, { message: e.message });
      }
    }
    // 2. Past the payment window with no answer: say "unknown". Never "failed", never release stock.
    for (const p of db.prepare(`SELECT provider_txn_id FROM payments WHERE status='PENDING' AND created_at < ?`).all(ago(config.paymentWindowSeconds))) {
      applyProviderEvent({ txnId: p.provider_txn_id, status: 'UNKNOWN', source: 'timeout' });
    }
    // 3. Give back stock held by orders that were never paid (no attempt in flight) after an idle period.
    db.transaction(() => {
      for (const o of db.prepare(`SELECT id FROM orders WHERE payment_status IN ('UNPAID','FAILED','CANCELLED') AND updated_at < ?`).all(ago(config.unpaidHoldSeconds))) {
        releaseReservation(o.id);
      }
    })();
  }

  /** After a crash/restart: any order that was mid-dispense is finalized. Units in doubt stay UNKNOWN. Nothing is re-sent. */
  function recoverOnBoot() {
    for (const o of db.prepare(`SELECT id FROM orders WHERE dispense_status='DISPENSING'`).all()) {
      audit('system', 'DISPENSE_RECOVERED_AFTER_RESTART', o.id, { result: finalizeDispense(o.id) });
    }
  }

  return { view, getOrderFor, activeOrderFor, createOrder, startPayment, cancelOrder, applyProviderEvent, reconcile, recoverOnBoot, runDispense };
}
