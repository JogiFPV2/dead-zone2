import type { Command } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { NOON } from '../test/ai-fixtures.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';

const map = buildMap({ width: 64, height: 64 });
const content = fixtureContent();
const opts = (seed: number) => ({
  seed,
  map,
  content,
  dev: true,
  clockStart: NOON,
  floorLoot: true,
  spawn: { x: 20.5, y: 20.5 },
  spawnZombies: [
    { x: 26.5, y: 20.5 },
    { x: 14.5, y: 22.5 },
    { x: 20.5, y: 30.5 },
  ],
});

function script(sim: Sim, from: number, to: number, seq: { n: number }): void {
  for (let t = from; t < to; t++) {
    const c = (cmd: Record<string, unknown>) =>
      sim.enqueue({ ...cmd, tick: sim.tick, playerId: 0, seq: seq.n++ } as unknown as Command);
    if (t === 5) c({ type: 'debugGiveItem', itemId: 'fixture:bat' });
    if (t === 6) c({ type: 'equip', item: 1, slot: 'hand_primary' });
    if (t % 40 === 0) c({ type: 'move', dx: ((t / 40) % 3) - 1, dy: 0 });
    if (t % 9 === 0) c({ type: 'aim', x: 26, y: 20.5 });
    if (t % 13 === 0) c({ type: 'attack' });
    sim.step();
  }
}

describe('save / load', () => {
  it('round trip: load → same hash now and after more ticks', () => {
    const a = createSim(opts(9));
    const seq = { n: 0 };
    script(a, 0, 400, seq);
    const blob = a.save();
    const b = createSim({ ...opts(1), load: blob });
    expect(b.tick).toBe(a.tick);
    expect(b.hash()).toBe(a.hash());
    const seqB = { n: seq.n };
    script(a, 400, 1200, seq);
    script(b, 400, 1200, seqB);
    expect(b.hash()).toBe(a.hash());
    expect(b.getZombies()).toEqual(a.getZombies());
  });

  it('refuses foreign data', () => {
    expect(() => createSim({ ...opts(1), load: Uint8Array.from([123, 125]) })).toThrow();
  });
});
