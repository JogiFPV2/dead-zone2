import { decodeSnapshot } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { BAM_FULL } from '../core/dmath.js';
import { createSim } from '../sim.js';
import { buildMap } from '../test/fixtures.js';
import { aim, move, run } from '../test/helpers.js';

const open = () => createSim({ seed: 1, map: buildMap(), spawn: { x: 10.5, y: 10.5 } });

describe('movement', () => {
  it('walks 3 tiles per second', () => {
    const sim = open();
    move(sim, 1, 0);
    run(sim, 20);
    const p = sim.getPlayer()!;
    expect(p.x).toBeCloseTo(13.5, 4);
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
    expect(Math.sqrt((p.x - 10.5) ** 2 + (p.y - 10.5) ** 2)).toBeCloseTo(3, 3);
  });

  it('allows slower analog movement below length 1', () => {
    const sim = open();
    move(sim, 0.5, 0);
    run(sim, 20);
    expect(sim.getPlayer()!.x).toBeCloseTo(12, 4);
  });

  it('holds the move intent until the next move command', () => {
    const sim = open();
    move(sim, 0, 1);
    run(sim, 10);
    move(sim, 0, 0);
    run(sim, 10);
    expect(sim.getPlayer()!.y).toBeCloseTo(12, 4);
  });

  it('faces the aim point, independent of movement', () => {
    const sim = open();
    aim(sim, 10.5, 20);
    move(sim, 1, 0);
    run(sim, 1);
    // Aim is straight south of the spawn; after one step east it is slightly south-west.
    expect(sim.getPlayer()!.facing).toBeGreaterThan(BAM_FULL / 4);
    expect(sim.getPlayer()!.facing).toBeLessThan(BAM_FULL / 4 + 400);
    aim(sim, 0, sim.getPlayer()!.y);
    run(sim, 1);
    expect(sim.getPlayer()!.facing).toBe(BAM_FULL / 2);
    expect(sim.getPlayer()!.facingRad).toBeCloseTo(Math.PI, 5);
  });

  it('faces the movement direction before the first aim', () => {
    const sim = open();
    move(sim, 0, -1);
    run(sim, 1);
    expect(sim.getPlayer()!.facing).toBe((BAM_FULL * 3) / 4);
  });

  it('writes the player first into the snapshot', () => {
    const sim = open();
    move(sim, 1, 0);
    run(sim, 2);
    const [p, ...rest] = decodeSnapshot(sim.snapshot());
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ stableId: 1, z: 0, y: 10.5 });
    expect(p!.x).toBeCloseTo(10.8, 5);
  });
});
