import crypto from 'node:crypto';

export const toMinor = (v) => Math.round(Number(v) * 100);

/**
 * SIMULATOR ONLY. Never allowed in production (see assertConfig).
 *
 * Payment provider contract:
 *   name
 *   initiate({ txnId, amountMinor, currency, reason, notifyUrl }) -> { checkoutUrl }
 *       throws Error with .definite = true when the provider definitely did NOT create the payment
 *   fetchStatus(txnId) -> { status, rawStatus, amountMinor?, currency? }
 *       status in PENDING | SUCCEEDED | FAILED | CANCELLED | UNKNOWN
 *   verifyWebhook(req) -> { ok: boolean, event?: { txnId, status, amountMinor?, currency?, rawStatus, dedupeKey, payload } }
 */
export function createMockProvider(config) {
  const txns = new Map();
  const sign = (raw) => crypto.createHmac('sha256', config.mock.webhookSecret).update(raw).digest('hex');

  async function emit(txnId, status, overrides = {}) {
    const t = txns.get(txnId);
    if (!t) throw new Error('unknown mock txn');
    t.status = status;
    const body = JSON.stringify({
      eventId: overrides.eventId ?? crypto.randomUUID(),
      txnId,
      status: status === 'SUCCEEDED' ? 'COMPLETED' : status,
      amount: overrides.amount ?? (t.amountMinor / 100).toFixed(2),
      currency: overrides.currency ?? t.currency,
    });
    try {
      await fetch(t.notifyUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': sign(body) }, body });
    } catch { /* webhook lost: the reconcile loop will find the result via fetchStatus */ }
  }

  return {
    name: 'mock',
    emit,
    sign,
    get: (txnId) => txns.get(txnId),
    async initiate({ txnId, amountMinor, currency, notifyUrl }) {
      txns.set(txnId, { status: 'PENDING', amountMinor, currency, notifyUrl });
      return { checkoutUrl: `${config.publicBaseUrl}/mock/pay/${encodeURIComponent(txnId)}` };
    },
    async fetchStatus(txnId) {
      const t = txns.get(txnId);
      if (!t) return { status: 'UNKNOWN', rawStatus: 'NOT_FOUND' }; // e.g. after a restart: do not guess
      return { status: t.status, rawStatus: t.status };
    },
    verifyWebhook(req) {
      const given = Buffer.from(req.get('x-mock-signature') ?? '', 'hex');
      const expected = Buffer.from(sign(req.rawBody ?? Buffer.alloc(0)), 'hex');
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false };
      const b = req.body ?? {};
      const map = { COMPLETED: 'SUCCEEDED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' };
      return {
        ok: true,
        event: {
          txnId: String(b.txnId), status: map[b.status] ?? 'UNKNOWN', rawStatus: String(b.status),
          amountMinor: b.amount !== undefined ? toMinor(b.amount) : undefined, currency: b.currency,
          dedupeKey: `mock:${b.eventId}`, payload: b,
        },
      };
    },
  };
}
