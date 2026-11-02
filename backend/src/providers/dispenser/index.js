import { createMockDispenser } from './mock.js';

export function createDispenser(config) {
  if (config.dispenser === 'mock') return createMockDispenser(config);
  throw new Error(`Unknown dispenser: ${config.dispenser}`);
}
