import { describe, expect, it } from 'vitest';
import {
  DRIFT_PERIOD_S,
  SHAMBLE_IDLE_S,
  SHAMBLE_WALK_S,
  menuCameraFrustum,
  menuDrift,
  shambleStep,
  type Shambler,
} from './menu-scene-model.js';

describe('menu scene model', () => {
  it('puts the target at 66% width with an asymmetric frustum', () => {
    const f = menuCameraFrustum(16 / 9, 22);
    const w = f.right - f.left;
    expect(-f.left / w).toBeCloseTo(0.66);
    expect(f.top - f.bottom).toBeCloseTo(22);
  });

  it('drifts slowly in a closed loop', () => {
    const a = menuDrift(0);
    const b = menuDrift(DRIFT_PERIOD_S);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
    let max = 0;
    for (let t = 0; t < DRIFT_PERIOD_S; t += 0.1) {
      const p = menuDrift(t);
      const q = menuDrift(t + 0.1);
      max = Math.max(max, Math.hypot(q.x - p.x, q.z - p.z) / 0.1);
    }
    expect(max).toBeLessThanOrEqual(0.3);
  });

  it('walks, stops and turns back', () => {
    const z: Shambler = { x: 0, y: 0, heading: 0, phase: 0.5, timer: 0, walking: true };
    expect(shambleStep(z, SHAMBLE_WALK_S)).toBe(false);
    expect(z.x).toBeGreaterThan(0);
    expect(shambleStep(z, SHAMBLE_IDLE_S + 0.5)).toBe(true);
    expect(Math.cos(z.heading)).toBeCloseTo(-1);
  });
});
