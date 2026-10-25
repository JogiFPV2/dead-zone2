import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM_LIMITS, zoomFromWheel } from '../../camera/zoom.js';
import {
  LONG_PRESS_MS,
  longPressHolds,
  TAP_MAX_MS,
  TAP_MAX_PX,
  TOUCH_DRAG_HOLD_MS,
  TouchGestures,
  dragDecision,
  pinchToWheel,
  type GestureEvent,
} from './gestures.js';

const setup = () => {
  const out: GestureEvent[] = [];
  return { g: new TouchGestures((e) => out.push(e)), out };
};

describe('touch gestures', () => {
  it('tap: short and still', () => {
    const { g, out } = setup();
    g.down(1, 50, 60, 0);
    g.move(1, 53, 62);
    g.up(1, 120);
    expect(out).toEqual([{ type: 'tap', x: 53, y: 62 }]);
  });

  it('drag is not a tap (moved ≥ TAP_MAX_PX, even if it comes back)', () => {
    const { g, out } = setup();
    g.down(1, 50, 60, 0);
    g.move(1, 50 + TAP_MAX_PX, 60);
    g.move(1, 50, 60);
    g.up(1, 100);
    expect(out).toEqual([]);
  });

  it('a slow press is not a tap; held still LONG_PRESS_MS is a long press (once)', () => {
    const { g, out } = setup();
    g.down(1, 10, 10, 0);
    g.poll(LONG_PRESS_MS - 1);
    expect(out).toEqual([]);
    g.poll(LONG_PRESS_MS);
    g.poll(LONG_PRESS_MS + 100);
    g.up(1, LONG_PRESS_MS + 200);
    expect(out).toEqual([{ type: 'longPress', x: 10, y: 10 }]);
    const s = setup();
    s.g.down(1, 0, 0, 0);
    s.g.up(1, TAP_MAX_MS + 1);
    expect(s.out).toEqual([]);
  });

  it('no long press after a drag', () => {
    const { g, out } = setup();
    g.down(1, 10, 10, 0);
    g.move(1, 40, 10);
    g.poll(LONG_PRESS_MS * 2);
    expect(out).toEqual([]);
  });

  it('pinch: scale between events; no tap from either finger afterwards', () => {
    const { g, out } = setup();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    g.move(2, 300, 100);
    g.move(1, 150, 100);
    g.up(1, 50);
    g.up(2, 60);
    expect(out).toEqual([
      { type: 'pinch', scale: 2 },
      { type: 'pinch', scale: 0.75 },
    ]);
    g.down(3, 0, 0, 100);
    g.up(3, 150);
    expect(out.at(-1)).toEqual({ type: 'tap', x: 0, y: 0 });
  });

  it('pinch → wheel delta gives exactly that zoom factor (existing camera zoom)', () => {
    const step = DEFAULT_ZOOM_LIMITS.step;
    const z = zoomFromWheel(1, pinchToWheel(1.25, step));
    expect(z).toBeCloseTo(1.25);
    expect(zoomFromWheel(1, pinchToWheel(0.8, step))).toBeCloseTo(0.8);
    expect(pinchToWheel(1, step)).toBeCloseTo(0);
  });

  it('inventory touch drag: wait, scroll before 150 ms, drag after; mouse at once', () => {
    expect(TOUCH_DRAG_HOLD_MS).toBe(150);
    expect(dragDecision(true, 500, 3, 6)).toBe('wait');
    expect(dragDecision(true, 100, 10, 6)).toBe('scroll');
    expect(dragDecision(true, 150, 10, 6)).toBe('drag');
    expect(dragDecision(false, 0, 6, 6)).toBe('drag');
  });
});

describe('longPressHolds', () => {
  it('needs the hold and a still finger', () => {
    expect(longPressHolds(LONG_PRESS_MS, 0)).toBe(true);
    expect(longPressHolds(LONG_PRESS_MS - 1, 0)).toBe(false);
    expect(longPressHolds(LONG_PRESS_MS, TAP_MAX_PX)).toBe(false);
  });
});
