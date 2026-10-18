import { BUILDING_KINDS as LOCK_BUILDING_KINDS } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from './types.js';

describe('rodzaje budynków dla zamków (@deadzone/content)', () => {
  it('to podzbiór BUILDING_KINDS generatora', () => {
    for (const k of LOCK_BUILDING_KINDS) expect(BUILDING_KINDS, k).toContain(k);
  });
});
