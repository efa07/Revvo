import { createMockProvider } from './mock.js';
import { createSantimPayProvider } from './santimpay.js';

export function createPaymentProvider(config) {
  if (config.paymentProvider === 'mock') return createMockProvider(config);
  if (config.paymentProvider === 'santimpay') return createSantimPayProvider(config);
  throw new Error(`Unknown payment provider: ${config.paymentProvider}`);
}
