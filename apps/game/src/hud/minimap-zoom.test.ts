import { describe, expect, it } from 'vitest';
import {
  MINIMAP_ZOOM_STEPS,
  canZoomIn,
  canZoomOut,
  nearestStep,
  stepMinimapZoom,
  wheelSteps,
} from './minimap-zoom.js';

describe('minimap zoom steps', () => {
  it('steps in and out and clamps at the ends', () => {
    expect(stepMinimapZoom(1, 1)).toBe(1.5);
    expect(stepMinimapZoom(1, -1)).toBe(0.75);
    expect(stepMinimapZoom(2, 1)).toBe(2);
    expect(stepMinimapZoom(0.5, -1)).toBe(0.5);
  });

  it('snaps odd values to the nearest step', () => {
    expect(nearestStep(1.1)).toBe(MINIMAP_ZOOM_STEPS.indexOf(1));
    expect(stepMinimapZoom(9, -1)).toBe(1.5);
    expect(stepMinimapZoom(0.01, 1)).toBe(0.75);
  });

  it('reports the limits', () => {
    expect(canZoomIn(2)).toBe(false);
    expect(canZoomOut(2)).toBe(true);
    expect(canZoomOut(0.5)).toBe(false);
    expect(canZoomIn(1)).toBe(true);
  });

  it('turns wheel deltas into whole steps', () => {
    expect(wheelSteps(0, -120)).toEqual({ acc: 0, step: 1 });
    expect(wheelSteps(0, 100)).toEqual({ acc: 0, step: -1 });
    const a = wheelSteps(0, -40);
    expect(a.step).toBe(0);
    expect(wheelSteps(a.acc, -60)).toEqual({ acc: 0, step: 1 });
  });
});
