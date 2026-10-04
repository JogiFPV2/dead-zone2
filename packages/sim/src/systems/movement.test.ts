import { decodeSnapshot } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { BAM_FULL } from '../core/dmath.js';
import { createSim } from '../sim.js';
import { buildMap } from '../test/fixtures.js';
import { aim, move, run } from '../test/helpers.js';
import { TICKS_PER_SECOND, WALK_SPEED_TILES_PER_SECOND } from '../core/constants.js';
import { TURN_BAM_PER_TICK, zombieWobble } from './movement.js';

/** Walk distance per tick (1.5 tiles/s → 0.075). */
const W = WALK_SPEED_TILES_PER_SECOND / TICKS_PER_SECOND;
/**
 * Distance lost while accelerating to walk speed: the jerk-limited S-curve (jerk 60 m/s³,
 * accel 6 m/s²) reaches 1.5 m/s in 6 ticks and loses 2.5 ticks of walking on the way.
 */
const ACCEL_LAG = W * 2.5;

const open = () => createSim({ seed: 1, map: buildMap(), spawn: { x: 10.5, y: 10.5 } });

describe('movement', () => {
  it('walks 1.5 tiles per second after a short acceleration', () => {
    const sim = open();
    move(sim, 1, 0);
    run(sim, 20);
    const p = sim.getPlayer()!;
    expect(p.x).toBeCloseTo(10.5 + WALK_SPEED_TILES_PER_SECOND - ACCEL_LAG, 4);
    expect(p.y).toBe(10.5);
  });

  it('keeps positions in f32', () => {
    const sim = open();
    move(sim, 0.37, -0.81);
    run(sim, 7);
    const p = sim.getPlayer()!;
    expect(Math.fround(p.x)).toBe(p.x);
    expect(Math.fround(p.y)).toBe(p.y);
  });

  it('clamps the direction vector to length 1 (diagonal is not faster)', () => {
    const sim = open();
    move(sim, 1, 1);
    run(sim, 20);
    const p = sim.getPlayer()!;
    expect(Math.sqrt((p.x - 10.5) ** 2 + (p.y - 10.5) ** 2)).toBeCloseTo(
      WALK_SPEED_TILES_PER_SECOND - ACCEL_LAG,
      3,
    );
  });

  it('allows slower analog movement below length 1', () => {
    const sim = open();
    move(sim, 0.5, 0);
    run(sim, 20);
    const x = sim.getPlayer()!.x;
    run(sim, 10);
    // Half the walk speed once at speed.
    expect(sim.getPlayer()!.x - x).toBeCloseTo(5 * W, 4);
  });

  it('holds the move intent until the next move command', () => {
    const sim = open();
    move(sim, 0, 1);
    run(sim, 10);
    // Still walking at full speed 10 ticks later (no repeated command needed).
    const y = sim.getPlayer()!.y;
    run(sim, 1);
    expect(sim.getPlayer()!.y - y).toBeCloseTo(W, 5);
    move(sim, 0, 0);
    run(sim, 10);
    const stopped = sim.getPlayer()!.y;
    run(sim, 5);
    expect(sim.getPlayer()!.y).toBe(stopped);
  });

  it('accelerates along a jerk-limited S-curve and brakes without overshoot', () => {
    const sim = open();
    move(sim, 1, 0);
    const xs: number[] = [];
    for (let i = 0; i < 10; i++) {
      run(sim, 1);
      xs.push(sim.getPlayer()!.x);
    }
    const steps = xs.map((x, i) => x - (xs[i - 1] ?? 10.5));
    // Speed rises monotonically to walk speed in 6 ticks and stays there.
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    expect(steps[0]!).toBeCloseTo(60 / 20 ** 3, 6); // first tick: accel built up at the jerk
    expect(steps[5]!).toBeCloseTo(W, 5);
    expect(steps[9]!).toBeCloseTo(W, 5);
    move(sim, 0, 0);
    let last = sim.getPlayer()!.x;
    for (let i = 0; i < 10; i++) {
      run(sim, 1);
      const x = sim.getPlayer()!.x;
      expect(x).toBeGreaterThanOrEqual(last); // never backs up
      last = x;
    }
    run(sim, 2);
    expect(sim.getPlayer()!.x).toBe(last);
  });

  it('turns the facing at a limited angular speed (720°/s)', () => {
    const sim = open();
    aim(sim, 20.5, 10.5);
    run(sim, 1);
    expect(sim.getPlayer()!.facing).toBe(0);
    aim(sim, 0.5, 10.5);
    run(sim, 1);
    expect(sim.getPlayer()!.facing).toBe(TURN_BAM_PER_TICK);
    run(sim, 10);
    expect(sim.getPlayer()!.facing).toBe(BAM_FULL / 2);
  });

  it('zombie pace wobbles smoothly and deterministically', () => {
    const vals = Array.from({ length: 48 }, (_, t) => zombieWobble(0x9e3779b9, t));
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0.8);
      expect(v).toBeLessThanOrEqual(1.2);
    }
    for (let i = 1; i < vals.length; i++)
      expect(Math.abs(vals[i]! - vals[i - 1]!)).toBeLessThan(0.1);
    expect(new Set(vals.map((v) => v.toFixed(2))).size).toBeGreaterThan(5);
    expect(zombieWobble(0x9e3779b9, 30)).toBe(vals[30]);
    expect(zombieWobble(12345, 30)).not.toBe(vals[30]);
  });

  it('faces the aim point, independent of movement', () => {
    const sim = open();
    aim(sim, 10.5, 20);
    move(sim, 1, 0);
    run(sim, 6);
    // Aim is straight south of the spawn; after walking east it is slightly south-west.
    expect(sim.getPlayer()!.facing).toBeGreaterThan(BAM_FULL / 4);
    expect(sim.getPlayer()!.facing).toBeLessThan(BAM_FULL / 4 + 2000);
    aim(sim, 0, sim.getPlayer()!.y);
    run(sim, 6);
    expect(sim.getPlayer()!.facing).toBe(BAM_FULL / 2);
    expect(sim.getPlayer()!.facingRad).toBeCloseTo(Math.PI, 5);
  });

  it('faces the movement direction before the first aim', () => {
    const sim = open();
    move(sim, 0, -1);
    run(sim, 6);
    expect(sim.getPlayer()!.facing).toBe((BAM_FULL * 3) / 4);
  });

  it('writes the player first into the snapshot', () => {
    const sim = open();
    move(sim, 1, 0);
    run(sim, 2);
    const [p, ...rest] = decodeSnapshot(sim.snapshot());
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ stableId: 1, z: 0, y: 10.5 });
    expect(p!.x).toBe(sim.getPlayer()!.x);
    // Locomotion fields (protocol 13): speed m/s, longitudinal accel m/s², gait walk.
    expect(p!.speed).toBeGreaterThan(0);
    expect(p!.accel).toBeGreaterThan(0);
    expect(p!.gait).toBe(1);
  });
});
