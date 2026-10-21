import { describe, expect, it } from 'vitest';
import { osmScene } from '../world/osm/scenes.js';
import { menuCameraFrustum } from './menu-scene-model.js';
import { menuRange, menuWindowMinute, sceneCars } from './menu-town.js';

describe('menu town (OSM background)', () => {
  it('covers the whole iso view (plus margin) with the chunk window', () => {
    const focus = { x: 168, y: 206 };
    const view = menuCameraFrustum(21 / 9, 32);
    const r = menuRange(focus, view, 0);
    // Project every chunk-window corner back: the view corners must lie inside the window.
    const k = Math.SQRT1_2;
    const down = Math.sin(Math.atan(Math.SQRT1_2)) * k;
    for (const sx of [view.left, view.right]) {
      for (const sy of [-view.top, -view.bottom]) {
        const a = sx / k;
        const b = sy / down;
        const x = focus.x + (a + b) / 2;
        const y = focus.y + (b - a) / 2;
        expect(x).toBeGreaterThanOrEqual(r.cx0 * 32);
        expect(x).toBeLessThan((r.cx1 + 1) * 32);
        expect(y).toBeGreaterThanOrEqual(r.cy0 * 32);
        expect(y).toBeLessThan((r.cy1 + 1) * 32);
      }
    }
    const wide = menuRange(focus, view, 8);
    expect(wide.cx0).toBeLessThanOrEqual(r.cx0);
    expect(wide.cy1).toBeGreaterThanOrEqual(r.cy1);
    expect(wide.z).toBe(0);
  });

  it('lights windows one by one at sunset and keeps them on until sunrise', () => {
    expect(menuWindowMinute(0, true)).toBe(12 * 60);
    expect(menuWindowMinute(0, false)).toBe(12 * 60);
    expect(menuWindowMinute(0.5, true)).toBe(19 * 60 + 45);
    expect(menuWindowMinute(1, true)).toBe(23 * 60);
    expect(menuWindowMinute(1, false)).toBe(23 * 60);
    // Fading out at sunrise: still night for windowLit (on before 06:00).
    expect(menuWindowMinute(0.4, false)).toBeLessThan(6 * 60);
  });

  it('poses the parked cars of the scene inside the window', () => {
    const scene = osmScene('osm-okulickiego');
    expect(scene).toBeDefined();
    const range = { cx0: 4, cy0: 5, cx1: 6, cy1: 6, z: 0 };
    const cars = sceneCars(scene!, range);
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) {
      expect(c.x).toBeGreaterThanOrEqual(128);
      expect(c.x).toBeLessThan(224);
      expect(c.y).toBeGreaterThanOrEqual(160);
      expect(c.y).toBeLessThan(224);
      expect(c.headlights).toBe(false);
    }
    expect(new Set(cars.map((c) => c.stableId)).size).toBe(cars.length);
  });
});
