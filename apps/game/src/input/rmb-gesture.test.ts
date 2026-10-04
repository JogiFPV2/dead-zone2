import { describe, expect, it } from 'vitest';
import { RMB_CLICK_MS, RmbGesture } from './rmb-gesture.js';

describe('RMB gesture (PZ-like)', () => {
  it('a short click is the context action', () => {
    const g = new RmbGesture();
    g.press(1000);
    expect(g.release(1000 + RMB_CLICK_MS - 1)).toBe(true);
  });

  it('a hold is only aiming', () => {
    const g = new RmbGesture();
    g.press(1000);
    expect(g.release(1000 + RMB_CLICK_MS + 1)).toBe(false);
  });

  it('LMB during the press (attack from the aim) is not a click', () => {
    const g = new RmbGesture();
    g.press(1000);
    g.attack();
    expect(g.release(1050)).toBe(false);
    g.press(2000);
    expect(g.release(2050)).toBe(true);
  });

  it('a release without a press or after cancel does nothing', () => {
    const g = new RmbGesture();
    expect(g.release(10)).toBe(false);
    g.press(0);
    g.cancel();
    expect(g.release(10)).toBe(false);
  });
});
