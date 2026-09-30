import { expect, it } from 'vitest';
import { PROTOCOL_VERSION } from './index.js';

it('exposes a positive integer protocol version', () => {
  expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  expect(PROTOCOL_VERSION).toBeGreaterThan(0);
});
