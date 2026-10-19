import { describe, expect, it } from 'vitest';
import { isLightNight, levelWindowKeys, litWindowKeys, windowKey } from './lit-windows.js';

describe('lit windows (view.litWindows, protocol 34)', () => {
  it('maps edge midpoints to window keys', () => {
    const keys = litWindowKeys([
      { edge: 1, x: 2.5, y: 2, z: 0 },
      { edge: 2, x: 4, y: 3.5, z: 0 },
      { edge: 3, x: 7, y: 1.5, z: 1 },
    ]);
    expect(keys).toEqual(
      new Set([windowKey(2, 2, 0, 'N'), windowKey(4, 3, 0, 'W'), windowKey(7, 1, 1, 'W')]),
    );
    expect(litWindowKeys([])).toEqual(new Set());
  });

  it('splits keys per level and lights only at night', () => {
    const keys = new Set([windowKey(1, 2, 0, 'N'), windowKey(3, 4, 1, 'W')]);
    expect(levelWindowKeys(keys, 1)).toEqual(new Set(['3,4,W']));
    expect(isLightNight(20 * 60)).toBe(true);
    expect(isLightNight(3 * 60)).toBe(true);
    expect(isLightNight(12 * 60)).toBe(false);
  });
});
