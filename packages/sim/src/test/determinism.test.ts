import type { Command } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { FixedStepLoop, type SimSpeed } from '../core/loop.js';
import { Rng } from '../core/rng.js';
import { createSim, type Sim } from '../sim.js';
import { buildMap } from './fixtures.js';

// A room with walls and holes so collisions are exercised.
const map = buildMap({
  floor: (x, y) => ((x * 7 + y * 13) % 29 === 0 ? 0 : 1),
  wallW: (x, y) => x % 9 === 0 && y % 5 !== 0,
  wallN: (x, y) => y % 11 === 0 && x % 4 !== 0,
});

/** Deterministic command script: a new move or aim every few ticks. */
function script(seed: number, ticks: number): Command[] {
  const rng = new Rng([seed, 1, 2, 3]);
  const out: Command[] = [];
  let seq = 0;
  for (let tick = 0; tick < ticks; tick += rng.int(1, 8)) {
    if (rng.chance(0.7)) {
      out.push({
        type: 'move',
        tick,
        playerId: 0,
        seq: seq++,
        dx: rng.nextFloat() * 2 - 1,
        dy: rng.nextFloat() * 2 - 1,
      });
    } else {
      out.push({
        type: 'aim',
        tick,
        playerId: 0,
        seq: seq++,
        x: rng.nextFloat() * 64,
        y: rng.nextFloat() * 64,
      });
    }
  }
  return out;
}

function runScript(seed: number, cmds: readonly Command[], ticks: number, every = 100): number[] {
  const sim = createSim({ seed, map, spawn: { x: 30.5, y: 30.5 } });
  const hashes: number[] = [];
  let i = 0;
  while (sim.tick < ticks) {
    while (i < cmds.length && cmds[i]!.tick === sim.tick) sim.enqueue(cmds[i++]!);
    sim.step();
    if (sim.tick % every === 0) hashes.push(sim.hash());
  }
  return hashes;
}

/** Same commands, driven by the real-time loop at a given speed with irregular frames. */
function runWithLoop(speed: SimSpeed, cmds: readonly Command[], ticks: number): Sim {
  const sim = createSim({ seed: 3, map, spawn: { x: 30.5, y: 30.5 } });
  let i = 0;
  const loop = new FixedStepLoop({
    step: () => {
      while (i < cmds.length && cmds[i]!.tick === sim.tick) sim.enqueue(cmds[i++]!);
      sim.step();
    },
  });
  loop.setSpeed(speed);
  const frames = [16, 17, 16.5, 33, 8];
  let f = 0;
  while (sim.tick < ticks) {
    loop.advance(frames[f++ % frames.length]!);
  }
  return sim;
}

describe('determinism', () => {
  const cmds = script(42, 2000);

  it('same seed + commands give the same hash every 100 ticks', () => {
    const a = runScript(3, cmds, 2000);
    const b = runScript(3, cmds, 2000);
    expect(a).toHaveLength(20);
    expect(a).toEqual(b);
  });

  it('matches the golden hash (update consciously with `vitest -u` and a note in the PR)', () => {
    expect(runScript(3, cmds, 2000).at(-1)?.toString(16)).toMatchInlineSnapshot(`"9cbf6d1f"`);
  });

  it('different seed or commands change the hash', () => {
    const base = runScript(3, cmds, 500).at(-1);
    expect(runScript(4, cmds, 500).at(-1)).not.toBe(base);
    expect(runScript(3, script(43, 500), 500).at(-1)).not.toBe(base);
  });

  it('actually moves the player (the scenario is not trivial)', () => {
    const sim = createSim({ seed: 3, map, spawn: { x: 30.5, y: 30.5 } });
    const h0 = sim.hash();
    for (const c of cmds.filter((c) => c.tick === 0)) sim.enqueue(c);
    for (let t = 0; t < 50; t++) sim.step();
    expect(sim.hash()).not.toBe(h0);
    expect(sim.getPlayer()!.x).not.toBe(30.5);
  });

  it('×1, ×2 and ×4 reach the same state at the same tick', () => {
    const ticks = 600;
    const hashes = ([1, 2, 4] as const).map((s) => {
      const sim = runWithLoop(s, cmds, ticks);
      // Loop may stop a few ticks past `ticks` in one frame; compare at a common tick instead.
      return { tick: sim.tick, hash: sim.hash() };
    });
    const ref = runScript(3, cmds, 2000, 1);
    for (const h of hashes) expect(h.hash).toBe(ref[h.tick - 1]);
  });
});
