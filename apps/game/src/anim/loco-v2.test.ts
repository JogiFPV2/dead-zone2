import { describe, expect, it } from 'vitest';
import { LocoBlend } from './locomotion-blend.js';
import { FOLLOW_THROUGH, GAIT_SHAPE, LocoV2, PIVOT_TIME, gaitShape } from './loco-v2.js';

const DEG = Math.PI / 180;

describe('loco v2 (anim-spec §2)', () => {
  it('gait table: bob / torso per gait', () => {
    expect(GAIT_SHAPE.walk.bob).toBe(0.025);
    expect(GAIT_SHAPE.run.bob).toBe(0.05);
    expect(GAIT_SHAPE.sneak.bob).toBe(0.01);
    expect(GAIT_SHAPE.walk.torso / DEG).toBeCloseTo(3);
    expect(GAIT_SHAPE.run.torso / DEG).toBeCloseTo(10);
    expect(GAIT_SHAPE.sprint.torso / DEG).toBeCloseTo(15);
    expect(GAIT_SHAPE.sneak.torso / DEG).toBeCloseTo(20);
    expect(gaitShape('run', 1, 1).torso / DEG).toBeCloseTo(15);
  });

  it('walking: hip bob twice per cycle within the walk amplitude × gain', () => {
    const blend = new LocoBlend();
    const v2 = new LocoV2();
    let min = 0;
    let max = -1;
    let dips = 0;
    let last = 0;
    for (let i = 0; i < 400; i++) {
      const l = blend.update({ speed: 1.5, accel: 0, gait: 'walk', yawRate: 0, dt: 1 / 60 });
      const o = v2.update(l, 'walk', 0, 0, 1 / 60);
      if (i > 200) {
        min = Math.min(min, o.bob);
        max = Math.max(max, o.bob);
        if (last > -0.02 && o.bob <= -0.02) dips++;
      }
      last = o.bob;
    }
    expect(max).toBeCloseTo(0, 3);
    expect(-min).toBeLessThanOrEqual(0.025 * 1.35 + 1e-6);
    expect(-min).toBeGreaterThan(0.015);
    // 200 frames ≈ 3.3 s at ~0.9 cycles/s ≈ 3 cycles → ~6 dips.
    expect(dips).toBeGreaterThanOrEqual(4);
  });

  it('stopping: arms follow through for 0.15 s, then rest', () => {
    const blend = new LocoBlend();
    const v2 = new LocoV2();
    for (let i = 0; i < 120; i++)
      v2.update(
        blend.update({ speed: 3.75, accel: 0, gait: 'run', yawRate: 0, dt: 1 / 60 }),
        'run',
        0,
        0,
        1 / 60,
      );
    let t = 0;
    let arms = 1;
    const phases: number[] = [];
    while (t < 0.6) {
      const l = blend.update({ speed: 0, accel: -8, gait: 'run', yawRate: 0, dt: 1 / 60 });
      const o = v2.update(l, 'run', 0, 0, 1 / 60);
      t += 1 / 60;
      if (!l.moving) {
        arms = o.arms;
        phases.push(o.phase);
      }
    }
    expect(arms).toBe(0);
    // The phase moved during the follow-through, then held still.
    expect(phases.length).toBeGreaterThan(FOLLOW_THROUGH * 60);
    expect(phases[phases.length - 1]).toBe(phases[phases.length - 2]);
  });

  it('pivot step on a > 120° reversal above 2 m/s, for 0.25 s', () => {
    const blend = new LocoBlend();
    const v2 = new LocoV2();
    let l = blend.update({ speed: 3.5, accel: 0, gait: 'run', yawRate: 0, dt: 0.5 });
    v2.update(l, 'run', 0, 0, 1 / 60);
    l = blend.update({ speed: 3.5, accel: 0, gait: 'run', yawRate: 0, dt: 1 / 60 });
    const o = v2.update(l, 'run', Math.PI, 0, 1 / 60);
    expect(o.pivot).toBe(true);
    expect(o.pitch).toBeLessThan(GAIT_SHAPE.run.torso);
    let p = o;
    for (let t = 0; t < PIVOT_TIME + 0.05; t += 1 / 60) p = v2.update(l, 'run', Math.PI, 0, 1 / 60);
    expect(p.pivot).toBe(false);
    // A 90° turn at speed is no pivot.
    const w = new LocoV2();
    w.update(l, 'run', 0, 0, 1 / 60);
    expect(w.update(l, 'run', Math.PI / 2, 0, 1 / 60).pivot).toBe(false);
  });

  it('turning on the spot over 45° takes small steps (2 per 90°)', () => {
    const blend = new LocoBlend();
    const v2 = new LocoV2();
    const still = blend.update({ speed: 0, accel: 0, gait: 'walk', yawRate: 0, dt: 1 });
    for (let i = 0; i < 30; i++) v2.update(still, 'walk', 0, 0, 1 / 60);
    expect(v2.update(still, 'walk', 0, 30 * DEG, 1 / 60).turning).toBe(false);
    const start = v2.update(still, 'walk', 0, 90 * DEG, 1 / 60);
    expect(start.turning).toBe(true);
    let moved = 0;
    let ph = start.phase;
    for (let i = 0; i < 120; i++) {
      const o = v2.update(still, 'walk', 0, 90 * DEG, 1 / 60);
      moved += (o.phase - ph + 1) % 1;
      ph = o.phase;
    }
    // 90° = 2 steps = 1 gait cycle (minus the first frame's step).
    expect(moved + 1.6 / 60).toBeCloseTo(1, 1);
  });
});
