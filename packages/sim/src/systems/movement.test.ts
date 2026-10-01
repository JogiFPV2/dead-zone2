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
/** Distance lost while accelerating to walk speed (W/tick in 4 steps: 0.75+0.5+0.25 ticks). */
const ACCEL_LAG = W * 1.5;

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
    expect(sim.getPlayer()!.x).toBeCloseTo(10.5 + WALK_SPEED_TILES_PER_SECOND / 2 - W / 4, 4);
  });

  it('holds the move intent until the next move command', () => {
    const sim = open();
    move(sim, 0, 1);
    run(sim, 10);
    move(sim, 0, 0);
    run(sim, 10);
    // Accelerates (−1.5 W), then brakes in 3 ticks (+2/3 W + 1/3 W).
    expect(sim.getPlayer()!.y).toBeCloseTo(10.5 + 10 * W - ACCEL_LAG + W, 4);
  });

  it('accelerates in 4 ticks and stops in 3', () => {
    const sim = open();
    move(sim, 1, 0);
    const xs: number[] = [];
    for (let i = 0; i < 5; i++) {
      run(sim, 1);
      xs.push(sim.getPlayer()!.x);
    }
    const steps = xs.map((x, i) => x - (xs[i - 1] ?? 10.5));
    steps.forEach((d, i) => expect(d).toBeCloseTo([0.25, 0.5, 0.75, 1, 1][i]! * W, 5));
    move(sim, 0, 0);
    run(sim, 3);
    const x = sim.getPlayer()!.x;
    run(sim, 2);
    expect(sim.getPlayer()!.x).toBe(x);
  });

  it('turns at a limited angular speed (720°/s)', () => {
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
    expect(p!.x).toBeCloseTo(10.5 + 0.25 * W + 0.5 * W, 5);
  });
});
