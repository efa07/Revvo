import jwt from 'jsonwebtoken';

/**
 * Real SantimPay adapter, written from "SantimPay Payment Gateway Integration Documentation V1.3".
 * STATUS: UNVERIFIED. Nothing here has been run against SantimPay. See README "Assumptions to verify".
 * Private key stays in the backend environment. Never import this file from the app.
 */
export function createSantimPayProvider(config) {
  const { baseUrl, merchantId, privateKey } = config.santimpay;

  // Docs: every request needs a freshly signed ES256 JWT carrying `generated` (unix seconds).
  // noTimestamp keeps the payload exactly as documented (no extra iat claim).
  const sign = (payload) =>
    jwt.sign({ ...payload, generated: Math.floor(Date.now() / 1000) }, privateKey, { algorithm: 'ES256', noTimestamp: true });

  async function post(path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  return {
    name: 'santimpay',

    // Hosted checkout (docs section 1). Returns { url }.
    async initiate({ txnId, amountMinor, reason, notifyUrl }) {
      const amount = amountMinor / 100; // docs: amount is a Number (ETB). ASSUMPTION: decimal ETB, currency implied.
      const signedToken = sign({ amount, paymentReason: reason, merchantId });
      let res;
      try {
        res = await post('/initiate-payment', {
          id: txnId, amount, reason, merchantId, signedToken, notifyUrl,
          successRedirectUrl: `${config.publicBaseUrl}/pay/return/success`,
          failureRedirectUrl: `${config.publicBaseUrl}/pay/return/failure`,
          cancelRedirectUrl: `${config.publicBaseUrl}/pay/return/cancel`,
        });
      } catch (cause) {
        throw Object.assign(new Error('SantimPay initiate: network error or timeout', { cause }), { definite: false });
      }
      if (res.status === 200 && res.data?.url) return { checkoutUrl: res.data.url };
      // 400/422 = rejected before any payment was created. 409 ("txn id already in use") and 5xx are ambiguous.
      const definite = res.status === 400 || res.status === 422;
      throw Object.assign(new Error(`SantimPay initiate failed (${res.status})`), { definite, status: res.status });
    },

    // Docs section 4: fetch-transaction-status. The documented response has NO amount/currency.
    async fetchStatus(txnId) {
      const signedToken = sign({ id: txnId, merId: merchantId });
      const res = await post('/fetch-transaction-status', { id: txnId, merchantId, signedToken });
      if (res.status !== 200) return { status: 'UNKNOWN', rawStatus: `HTTP_${res.status}` }; // incl. "record not found": do not guess
      const raw = String(res.data?.status ?? '');
      // Only COMPLETED is documented for C2B success. Other strings are ASSUMPTIONS; anything else stays UNKNOWN (fail safe).
      const map = { COMPLETED: 'SUCCEEDED', PENDING: 'PENDING', FAILED: 'FAILED', CANCELLED: 'CANCELLED' };
      return { status: map[raw] ?? 'UNKNOWN', rawStatus: raw };
    },

    // The guide only says "validate the signedToken in the request header" with no header name, claims or body binding.
    // Until SantimPay confirms the scheme we FAIL CLOSED: callbacks are rejected and the reconcile loop
    // (fetchStatus polling) is the only path that can mark a payment as succeeded.
    verifyWebhook() {
      return { ok: false };
    },
  };
}
