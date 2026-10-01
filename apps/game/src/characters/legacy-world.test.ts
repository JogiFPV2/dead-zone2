import { describe, expect, it } from 'vitest';
import { seedFromSave } from './legacy-world.js';

describe('seedFromSave', () => {
  it('reads the seed from the save header', () => {
    const b = new TextEncoder().encode(
      '{"format":"dz","version":3,"protocol":8,"seed":12345,"tick":9}',
    );
    expect(seedFromSave(b.buffer)).toBe(12345);
    expect(seedFromSave(new TextEncoder().encode('garbage').buffer)).toBeUndefined();
  });
});
