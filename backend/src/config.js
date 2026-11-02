// All configuration comes from environment variables. Nothing secret is committed.
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(e = process.env) {
  const port = num(e.PORT, 3000);
  return {
    nodeEnv: e.NODE_ENV ?? 'development',
    port,
    dbPath: e.DB_PATH ?? './data/revov.db',
    jwtSecret: e.JWT_SECRET ?? '',
    jwtExpiresIn: e.JWT_EXPIRES_IN ?? '8h',
    machineId: e.MACHINE_ID ?? 'RV-014',
    // Must be reachable by the customer's phone (QR checkout) and by the payment provider (webhook).
    publicBaseUrl: (e.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    currency: 'ETB',
    paymentProvider: e.PAYMENT_PROVIDER ?? 'mock', // 'mock' | 'santimpay'
    dispenser: e.DISPENSER ?? 'mock', // 'mock' now; real controller adapter later
    paymentWindowSeconds: num(e.PAYMENT_WINDOW_SECONDS, 600),
    unpaidHoldSeconds: num(e.UNPAID_HOLD_SECONDS, 300),
    reconcileIntervalMs: num(e.RECONCILE_INTERVAL_MS, 10_000),
    mock: {
      webhookSecret: e.MOCK_WEBHOOK_SECRET ?? '',
      dispenseScenario: e.MOCK_DISPENSE_SCENARIO ?? 'ok', // ok | fail-second | fail-all | lost-ack
      dispenseDelayMs: num(e.MOCK_DISPENSE_DELAY_MS, 1200),
    },
    santimpay: {
      baseUrl: (e.SANTIMPAY_BASE_URL ?? '').replace(/\/$/, ''), // e.g. https://services.santimpay.com/api/v1/gateway (UNVERIFIED)
      merchantId: e.SANTIMPAY_MERCHANT_ID ?? '',
      privateKey: (e.SANTIMPAY_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'), // EC P-256 PEM, backend only
    },
  };
}

/** Fail fast on unsafe configuration. Fakes can never run in production. */
export function assertConfig(c) {
  const fail = (m) => { throw new Error(`Config error: ${m}`); };
  if (c.jwtSecret.length < 32) fail('JWT_SECRET must be at least 32 characters');
  if (!['mock', 'santimpay'].includes(c.paymentProvider)) fail('PAYMENT_PROVIDER must be mock or santimpay');
  if (c.dispenser !== 'mock') fail('DISPENSER: only "mock" exists yet; add a real adapter in providers/dispenser');
  if (c.paymentProvider === 'mock' && c.mock.webhookSecret.length < 16) fail('MOCK_WEBHOOK_SECRET must be at least 16 characters');
  if (c.paymentProvider === 'santimpay') {
    const s = c.santimpay;
    if (!s.baseUrl.startsWith('https://')) fail('SANTIMPAY_BASE_URL must be an https URL');
    if (!s.merchantId || !s.privateKey) fail('SANTIMPAY_MERCHANT_ID and SANTIMPAY_PRIVATE_KEY are required');
  }
  if (c.nodeEnv === 'production') {
    if (c.paymentProvider === 'mock' || c.dispenser === 'mock') fail('mock payment/dispense providers are forbidden when NODE_ENV=production');
    if (!c.publicBaseUrl.startsWith('https://')) fail('PUBLIC_BASE_URL must be https in production');
  }
}
