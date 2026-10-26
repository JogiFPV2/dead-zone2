import { describe, expect, it } from 'vitest';
import { pinchStep, stepMinimapZoom } from '../minimap-zoom.js';
import {
  MINIMAP_TOUCH_STEPS,
  radiusForZoom,
  radiusLabel,
  touchMinimapZoom,
} from './minimap-levels.js';

describe('touch minimap levels', () => {
  it('four levels: 480 / 240 / 120 / 60 m, ascending zoom', () => {
    expect(MINIMAP_TOUCH_STEPS.map((z) => Math.round(radiusForZoom(z)))).toEqual([
      480, 240, 120, 60,
    ]);
  });
  it('defaults to 120 m, also for desktop-range saved values', () => {
    expect(radiusLabel(touchMinimapZoom(1))).toBe('120 m');
    expect(radiusLabel(touchMinimapZoom(0))).toBe('120 m');
  });
  it('keeps a saved touch level', () => {
    expect(touchMinimapZoom(MINIMAP_TOUCH_STEPS[3]!)).toBe(MINIMAP_TOUCH_STEPS[3]);
    expect(touchMinimapZoom(MINIMAP_TOUCH_STEPS[0]!)).toBe(MINIMAP_TOUCH_STEPS[0]);
  });
  it('+/− walk the touch levels and clamp', () => {
    const z120 = MINIMAP_TOUCH_STEPS[2]!;
    expect(radiusLabel(stepMinimapZoom(z120, 1, MINIMAP_TOUCH_STEPS))).toBe('60 m');
    expect(radiusLabel(stepMinimapZoom(MINIMAP_TOUCH_STEPS[3]!, 1, MINIMAP_TOUCH_STEPS))).toBe(
      '60 m',
    );
    expect(radiusLabel(stepMinimapZoom(z120, -1, MINIMAP_TOUCH_STEPS))).toBe('240 m');
  });
  it('pinch: ±25 % finger distance = one step', () => {
    expect(pinchStep(1.3)).toBe(1);
    expect(pinchStep(0.75)).toBe(-1);
    expect(pinchStep(1.1)).toBe(0);
  });
});
