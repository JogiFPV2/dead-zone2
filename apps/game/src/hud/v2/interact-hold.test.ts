import { describe, expect, it } from 'vitest';
import { InteractHold, TAP_MS, sameTarget } from './interact-hold.js';

const box = { container: 7 };
const on = (target: { container: number } | { x: number; y: number } | undefined = box) => ({
  held: true,
  target,
  interrupted: false,
});

describe('InteractHold', () => {
  it('without a target the press is a tap right away', () => {
    expect(new InteractHold().press(0, undefined)).toEqual({ type: 'tap', target: undefined });
  });

  it('a short press is a tap on the target', () => {
    const h = new InteractHold();
    expect(h.press(0, box)).toBeUndefined();
    expect(h.update(100, on())).toBeUndefined();
    expect(h.update(150, { ...on(), held: false })).toEqual({ type: 'tap', target: box });
    expect(h.active).toBe(false);
  });

  it('holding past the tap window starts the search once; releasing then reports it', () => {
    const h = new InteractHold();
    h.press(0, box);
    expect(h.update(TAP_MS, on())).toEqual({ type: 'start', target: box });
    expect(h.searching).toBe(true);
    expect(h.update(2000, on())).toBeUndefined();
    expect(h.update(2100, { ...on(), held: false })).toEqual({ type: 'release' });
    expect(h.active).toBe(false);
  });

  it('a target change or moving before the start cancels', () => {
    const h = new InteractHold();
    h.press(0, box);
    expect(h.update(100, on({ container: 8 }))).toEqual({ type: 'cancel', reason: 'target' });
    h.press(0, { x: 3, y: 4 });
    expect(h.update(100, on({ x: 3, y: 4 }))).toBeUndefined();
    expect(h.update(TAP_MS, { ...on({ x: 3, y: 4 }), interrupted: true })).toEqual({
      type: 'cancel',
      reason: 'interrupted',
    });
  });

  it('compares targets by value', () => {
    expect(sameTarget({ container: 1 }, { container: 1 })).toBe(true);
    expect(sameTarget({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(sameTarget({ x: 1, y: 2 }, { container: 1 })).toBe(false);
    expect(sameTarget(undefined, { container: 1 })).toBe(false);
  });
});
