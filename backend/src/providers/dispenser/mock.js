const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * SIMULATOR ONLY. Dispenser contract (what a real controller adapter must implement):
 *   dispense({ commandId, orderRef, productId, slot }) -> { outcome: 'DELIVERED' | 'FAILED' | 'UNKNOWN' }
 *   - commandId is stable per unit. The adapter must not vend twice for the same commandId.
 *   - FAILED means the controller PROVES nothing was dispensed. Anything doubtful is UNKNOWN.
 * Scenarios (MOCK_DISPENSE_SCENARIO): ok | fail-second | fail-all | lost-ack
 */
export function createMockDispenser(config) {
  const results = new Map(); // commandId -> outcome (idempotent like a good controller)
  const perOrder = new Map();
  const calls = [];
  return {
    name: 'mock',
    calls,
    async dispense({ commandId, orderRef, productId, slot }) {
      if (results.has(commandId)) return { outcome: results.get(commandId) };
      await sleep(config.mock.dispenseDelayMs);
      const n = (perOrder.get(orderRef) ?? 0) + 1;
      perOrder.set(orderRef, n);
      calls.push({ commandId, orderRef, productId, slot });
      const s = config.mock.dispenseScenario;
      let outcome = 'DELIVERED';
      if (s === 'fail-all' || (s === 'fail-second' && n === 2)) outcome = 'FAILED';
      if (s === 'lost-ack' && n === 1) outcome = 'UNKNOWN';
      results.set(commandId, outcome);
      return { outcome };
    },
  };
}
