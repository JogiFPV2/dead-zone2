import { describe, expect, it } from 'vitest';
import {
  FURNITURE_REASONS_PL,
  furnitureActionPl,
  furnitureReasonPl,
  furnitureTypePl,
} from './furniture-labels.js';

describe('furniture menu labels (pl)', () => {
  it('reason texts (sim checks the full protocol list against this map)', () => {
    expect(Object.keys(FURNITURE_REASONS_PL)).toContain('threat');
    expect(furnitureReasonPl('no-water')).toBe('Brak wody w sieci');
  });

  it('prefixed ids take the prefix label; unknown ids fall back', () => {
    expect(furnitureActionPl('lockpick:42')).toBe('Użyj wytrycha');
    expect(furnitureActionPl('open')).toBe('Otwórz');
    expect(furnitureActionPl('mystery')).toBe('mystery');
    expect(furnitureTypePl('door')).toBe('Drzwi');
  });
});
