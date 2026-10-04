// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema.js';
import { bindUiScale, scaledUi, setUiScale, snapUiScale, uiScale } from './ui-scale.js';

describe('ui scale', () => {
  afterEach(() => setUiScale(0.9));

  it('snaps to 5 % steps inside 60–120 %', () => {
    expect([0.1, 0.62, 0.874, 1, 1.13, 9, Number.NaN].map(snapUiScale)).toEqual([
      0.6, 0.6, 0.85, 1, 1.15, 1.2, 0.9,
    ]);
  });

  it('a change relayouts the UI through a resize event and multiplies layer scales', () => {
    const fire = vi.fn();
    window.addEventListener('resize', fire);
    setUiScale(0.7);
    setUiScale(0.7);
    window.removeEventListener('resize', fire);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(uiScale()).toBe(0.7);
    expect(scaledUi(1.25)).toBe(0.88);
  });

  it('follows the stored setting', () => {
    let cur: Settings = {
      ...DEFAULT_SETTINGS,
      graphics: { ...DEFAULT_SETTINGS.graphics, uiScale: 1.1 },
    };
    let listener: ((s: Settings) => void) | undefined;
    const unbind = bindUiScale({
      get: () => cur,
      subscribe: (l) => {
        listener = l as (s: Settings) => void;
        return () => (listener = undefined);
      },
    });
    expect(uiScale()).toBe(1.1);
    cur = { ...cur, graphics: { ...cur.graphics, uiScale: 0.75 } };
    listener?.(cur);
    expect(uiScale()).toBe(0.75);
    unbind();
    expect(listener).toBeUndefined();
  });
});
