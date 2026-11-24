import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem } from '../test/item-fixtures.js';
import { FISH_MINUTES, catchChance, nearWater } from './fishing.js';

const content = await baseContent();

/** Grass with a pond from x = 14 to the east. */
function sim(spawnX: number, seed = 5): Sim {
  return createSim({
    seed,
    map: buildMap({
      width: 32,
      height: 32,
      floor: (x) => (x >= 14 ? 2 : 1),
      floorTiles: [null, 'base:grass', 'base:water'],
    }),
    spawn: { x: spawnX, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 10, minute: 0 },
  });
}

function withRod(s: Sim): number {
  send(s, { type: 'debugGiveItem', itemId: 'base:fishing-rod' });
  s.step();
  return findItem(s, 'base:fishing-rod')!.id;
}

describe('fishing (docs 9.84)', () => {
  it('needs water within reach', () => {
    const far = sim(5.5);
    expect(nearWater(far.world, far.world.players.get(0)!)).toBe(false);
    const rod = withRod(far);
    far.drainEvents();
    send(far, { type: 'useItem', item: rod });
    far.step();
    expect(far.drainEvents().some((e) => e.type === 'commandRejected' && e.reason === 'invalid-target')).toBe(true);
  });

  it('a session at the shore ends with a fish or nothing, XP either way', () => {
    let caught = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = sim(12.5, seed);
      expect(nearWater(s.world, s.world.players.get(0)!)).toBe(true);
      const rod = withRod(s);
      s.drainEvents();
      send(s, { type: 'useItem', item: rod });
      runMinutes(s, FISH_MINUTES + 1);
      const ev = s.drainEvents().filter((e) => e.type === 'fished');
      expect(ev).toHaveLength(1);
      const f = ev[0] as Extract<(typeof ev)[number], { type: 'fished' }>;
      expect(!!findItem(s, 'base:raw-fish')).toBe(f.caught);
      if (f.caught) caught++;
      const skill = s.drainView()?.skills?.find((k) => k.id === 'base:fishing');
      if (skill) expect(skill.xp).toBeGreaterThan(0);
    }
    expect(caught).toBeGreaterThan(0);
    expect(caught).toBeLessThan(6);
  });

  it('a better angler catches more often, up to the cap', () => {
    expect(catchChance(0)).toBeCloseTo(0.3);
    expect(catchChance(5)).toBeGreaterThan(catchChance(0));
    expect(catchChance(10)).toBe(0.85);
  });
});
