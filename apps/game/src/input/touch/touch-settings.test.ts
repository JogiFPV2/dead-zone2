import { describe, expect, it } from 'vitest';
import { isTouchDevice, lockLandscape, pixelRatioFor, touchSettings } from './touch-settings.js';

const DESKTOP = { coarse: false, maxTouchPoints: 0, touchEvents: false };
const LAPTOP_TOUCHSCREEN = { coarse: false, maxTouchPoints: 10, touchEvents: true };
const PHONE = { coarse: true, maxTouchPoints: 5, touchEvents: true };

describe('touch settings', () => {
  it('desktop: nothing changes (no touch, URL / default quality, no lock)', () => {
    for (const env of [DESKTOP, LAPTOP_TOUCHSCREEN]) {
      expect(isTouchDevice(env)).toBe(false);
      expect(touchSettings('', env)).toEqual({
        touch: false,
        debug: false,
        quality: undefined,
        landscape: false,
      });
    }
    expect(pixelRatioFor(3, false, 'medium')).toBe(2);
    expect(pixelRatioFor(1, false, 'low')).toBe(1);
  });

  it('phone: touch, quality=low, landscape, DPR 1.5–2', () => {
    expect(touchSettings('', PHONE)).toEqual({
      touch: true,
      debug: false,
      quality: 'low',
      landscape: true,
    });
    expect(pixelRatioFor(3, true, 'low')).toBe(1.5);
    expect(pixelRatioFor(3, true, 'high')).toBe(2);
    expect(pixelRatioFor(1, true, 'low')).toBe(1);
  });

  it('URL wins: ?touch, ?quality, ?landscape=0, ?touchDebug', () => {
    expect(touchSettings('?touch=1', DESKTOP).touch).toBe(true);
    expect(touchSettings('?touch=0', PHONE)).toMatchObject({ touch: false, quality: undefined });
    expect(touchSettings('?quality=high', PHONE).quality).toBeUndefined();
    expect(touchSettings('?quality=bogus', PHONE).quality).toBe('low');
    expect(touchSettings('?landscape=0', PHONE).landscape).toBe(false);
    expect(touchSettings('?touchDebug=1', DESKTOP)).toMatchObject({ touch: true, debug: true });
    expect(touchSettings('?touch=0', PHONE, 'touch').touch).toBe(false);
  });

  it('setting Auto / Dotyk / Mysz', () => {
    expect(touchSettings('', DESKTOP, 'touch').touch).toBe(true);
    expect(touchSettings('', PHONE, 'mouse').touch).toBe(false);
    expect(touchSettings('', PHONE, 'auto').touch).toBe(true);
  });

  it('landscape lock: true when it takes, false when refused or missing', async () => {
    expect(await lockLandscape({ lock: () => Promise.resolve() })).toBe(true);
    expect(await lockLandscape({ lock: () => Promise.reject(new Error('no')) })).toBe(false);
    expect(await lockLandscape({})).toBe(false);
    expect(await lockLandscape(undefined)).toBe(false);
  });
});
