import type { Command } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { send as sendOnce } from './content-fixtures.js';
import { itemsSim } from './item-fixtures.js';

/** Items scenario: search two storages, take loot, eat, drop, bag, walk away. */
function script(): Command[] {
  let seq = 0;
  const c = (tick: number, cmd: Record<string, unknown>) =>
    ({ playerId: 0, tick, seq: seq++, ...cmd }) as Command;
  return [
    c(0, { type: 'debugGiveItem', itemId: 'fixture:backpack' }),
    c(0, { type: 'debugGiveItem', itemId: 'fixture:opener' }),
    c(0, { type: 'openContainer', container: 1 }),
    c(0, { type: 'openContainer', container: 2 }),
    c(300, { type: 'debugStat', stat: 'hunger', value: 60 }),
    c(300, { type: 'equip', item: 1, slot: 'back' }),
    c(400, { type: 'move', dx: 1, dy: 0.5 }),
    c(420, { type: 'move', dx: 0, dy: 0 }),
    c(500, { type: 'move', dx: -1, dy: -0.5 }),
    c(520, { type: 'move', dx: 0, dy: 0 }),
    c(2000, { type: 'move', dx: 1, dy: 1 }),
  ];
}

/** Takes every item of the open container into the backpack, then eats what can be eaten. */
function loot(sim: Sim): void {
  let seq = 10_000;
  const send = (sim: Sim, cmd: Record<string, unknown>) =>
    sim.enqueue({ playerId: 0, tick: sim.tick, seq: seq++, ...cmd } as Command);
  const inv = sim.getInventory()!;
  const pack = inv.containers!.find((c) => c.kind === 'bag')!;
  for (const id of [1, 2]) {
    for (const it of sim.getContainer(id)?.items ?? []) {
      send(sim, { type: 'moveItem', item: it.id, to: pack.id });
      if (it.def === 'fixture:beans' || it.def === 'fixture:water') {
        send(sim, { type: 'useItem', item: it.id });
      }
    }
  }
}

function run(seed: number, ticks: number, every = 250, onEnd?: (sim: Sim) => void): number[] {
  const sim = itemsSim(undefined, { seed });
  const cmds = script();
  let i = 0;
  const out: number[] = [];
  while (sim.tick < ticks) {
    while (i < cmds.length && cmds[i]!.tick === sim.tick) sim.enqueue(cmds[i++]!);
    if (sim.tick === 600) loot(sim);
    sim.step();
    if (sim.tick % every === 0) out.push(sim.hash());
  }
  onEnd?.(sim);
  return out;
}

describe('items determinism', () => {
  it('same seed and commands → identical hashes (items, loot, actions in the hash)', () => {
    expect(run(3, 3000)).toEqual(run(3, 3000));
  });

  it('the scenario really searches, loots into the worn bag and leaves', () => {
    run(11, 3000, 1000, (sim) => {
      const inv = sim.getInventory()!;
      const pack = inv.containers!.find((c) => c.kind === 'bag')!;
      expect(pack.items.length).toBeGreaterThan(0);
      expect(inv.equipped.back).toBeDefined();
      expect(sim.getContainer(1)!.items).toEqual([]);
    });
  });

  it('the loot depends on the world seed', () => {
    const a = run(3, 400);
    const b = run(4, 400);
    expect(a.at(-1)).not.toBe(b.at(-1));
  });

  it('every item change moves the hash', () => {
    const sim = itemsSim();
    sendOnce(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 2 });
    sim.step();
    const h0 = sim.hash();
    sendOnce(sim, { type: 'drop', item: 1, count: 1 });
    sim.step();
    const h1 = sim.hash();
    expect(h1).not.toBe(h0);
    sim.step();
    expect(sim.hash()).not.toBe(h1); // tick changed; same item state otherwise
  });

  it('matches the golden hash (update consciously with `vitest -u` and a note in the PR)', () => {
    const hashes = run(11, 3000, 1000);
    expect(hashes.map((h) => h.toString(16).padStart(8, '0'))).toMatchInlineSnapshot(`
      [
        "ebb706f8",
        "2a92e369",
        "0c4cfbc4",
      ]
    `);
  });
});
