import type { Command } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { FixedStepLoop, type SimSpeed } from '../core/loop.js';
import type { Sim } from '../sim.js';
import { fixtureContent, survivalSim } from './content-fixtures.js';

const content = fixtureContent();
const H = { playerId: 0 };

/** Survival scenario: zombie wounds, bandages, sleep and movement over ~6 game hours. */
function script(): Command[] {
  let seq = 0;
  const c = (tick: number, cmd: Record<string, unknown>) =>
    ({ ...H, tick, seq: seq++, ...cmd }) as Command;
  return [
    c(0, { type: 'debugWound', part: 'forearm_l', wound: 'bite', zombie: true }),
    c(0, { type: 'debugGiveItem', itemId: 'fixture:bandage', count: 2 }),
    c(0, { type: 'debugWound', part: 'shin_r', wound: 'scratch', zombie: true }),
    c(0, { type: 'move', dx: 1, dy: 0.25 }),
    c(400, { type: 'debugWound', part: 'torso_lower', wound: 'laceration', zombie: true }),
    c(1190, { type: 'move', dx: 0, dy: 0 }),
    c(1200, { type: 'bandage', part: 'forearm_l', itemId: 'fixture:bandage' }),
    c(2000, { type: 'move', dx: -0.5, dy: 1 }),
    c(3000, { type: 'move', dx: 0, dy: 0 }),
    c(3000, { type: 'debugStat', stat: 'fatigue', value: 70 }),
    c(3001, { type: 'sleep' }),
    c(9000, { type: 'wake' }),
    c(9100, { type: 'debugWound', part: 'hand_r', wound: 'deep' }),
    c(9500, { type: 'bandage', part: 'hand_r' }),
    c(12000, { type: 'move', dx: 1, dy: -1 }),
  ];
}

function feed(sim: Sim, cmds: readonly Command[], i: number): number {
  while (i < cmds.length && cmds[i]!.tick === sim.tick) sim.enqueue(cmds[i++]!);
  return i;
}

function runScript(seed: number, ticks: number, every = 1000): number[] {
  const sim = survivalSim(content, { seed });
  const cmds = script();
  const out: number[] = [];
  let i = 0;
  while (sim.tick < ticks) {
    i = feed(sim, cmds, i);
    sim.step();
    if (sim.tick % every === 0) out.push(sim.hash());
  }
  return out;
}

function runWithLoop(speed: SimSpeed, ticks: number): Sim {
  const sim = survivalSim(content, { seed: 5 });
  const cmds = script();
  let i = 0;
  const loop = new FixedStepLoop({
    step: () => {
      i = feed(sim, cmds, i);
      sim.step();
    },
  });
  loop.setSpeed(speed);
  const frames = [16, 17, 16.5, 33, 8];
  let f = 0;
  while (sim.tick < ticks) loop.advance(frames[f++ % frames.length]!);
  return sim;
}

describe('survival determinism', () => {
  it('same seed + commands → same hash every 1000 ticks', () => {
    const a = runScript(5, 18_000);
    expect(a).toHaveLength(18);
    expect(runScript(5, 18_000)).toEqual(a);
  });

  it('matches the golden hash (update consciously with `vitest -u` and a note in the PR)', () => {
    expect(runScript(5, 18_000).at(-1)?.toString(16)).toMatchInlineSnapshot(`"b92e4fda"`);
  });

  it('the hash covers survival state (stats, wounds, virus) and the seed changes the rolls', () => {
    const a = survivalSim(content, { seed: 5 });
    const b = survivalSim(content, { seed: 5 });
    expect(a.hash()).toBe(b.hash());
    a.enqueue({ ...H, tick: 0, seq: 1, type: 'debugStat', stat: 'hunger', value: 1 });
    a.step();
    b.step();
    expect(a.hash()).not.toBe(b.hash());
    const outcomes = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => runScript(s, 2000).at(-1)));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('×1, ×2 and ×4 reach the same state', () => {
    const ref = runScript(5, 3000, 1);
    for (const speed of [1, 2, 4] as const) {
      const sim = runWithLoop(speed, 2500);
      expect(sim.hash()).toBe(ref[sim.tick - 1]);
    }
  });

  it('extra rolls in another RNG stream do not change health outcomes (stream health)', () => {
    const plain = survivalSim(content, { seed: 9 });
    const noisy = survivalSim(content, { seed: 9 });
    const cmds = script();
    let i = 0;
    let j = 0;
    for (let t = 0; t < 6000; t++) {
      i = feed(plain, cmds, i);
      j = feed(noisy, cmds, j);
      noisy.world.rng.combat.nextU32();
      plain.step();
      noisy.step();
    }
    expect(noisy.getSurvival()).toEqual(plain.getSurvival());
  });
});
