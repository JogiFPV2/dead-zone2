import type { CharacterSpec } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { dynamicTraitsSystem } from './dynamic-traits.js';

const content = await baseContent();

const spec = (traits: string[]): CharacterSpec => ({
  firstName: 'Jan',
  lastName: 'Kowal',
  appearance: {
    skin: 'olive',
    parts: {
      head: { part: 'base:head-long', colors: { primary: 'ginger' } },
      top: { part: 'base:top-hoodie', colors: { primary: 'navy' } },
      bottom: { part: 'base:bottom-jeans' },
      shoes: { part: 'base:shoes-boots', colors: { primary: 'charcoal' } },
    },
  },
  profession: 'base:unemployed',
  traits,
  skills: {},
});

function sim(o: { traits?: string[]; load?: Uint8Array } = {}): Sim {
  return createSim({
    seed: 3,
    map: buildMap({ width: 24, height: 24 }),
    spawn: { x: 8.5, y: 8.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(o.load ? { load: o.load } : { character: spec(o.traits ?? []) }),
  });
}

const eid = (s: Sim) => s.world.players.get(0)!;
const traitsOf = (s: Sim) => {
  const w = s.world;
  return w.items!.characters.get(w.c.StableId.value[eid(s)]!)!.traits;
};
/** Runs the system for game minute `m` only (no survival, so test-set vitals stay). */
const minute = (s: Sim, m: number) => dynamicTraitsSystem(s.world, { first: m, count: 1 });

describe('traits gained and lost in the game (docs 9.83)', () => {
  it('250 kills make the character hardened at once, with an event', () => {
    const s = sim();
    s.step();
    s.world.events.length = 0;
    s.world.ai!.combat.kills[eid(s)] = 249;
    minute(s, 10);
    expect(traitsOf(s)).not.toContain('base:hardened');
    s.world.ai!.combat.kills[eid(s)] = 250;
    minute(s, 11);
    expect(traitsOf(s)).toContain('base:hardened');
    expect(eventsOf(s.world.events, 'traitChanged')).toEqual([
      expect.objectContaining({ trait: 'base:hardened', gained: true }),
    ]);
    // Gained once; nothing more.
    minute(s, 12);
    expect(eventsOf(s.world.events, 'traitChanged')).toHaveLength(1);
  });

  it('overweight only after 3 days above 95 kg, a break restarts the count, athletic goes', () => {
    const s = sim({ traits: ['base:athletic'] });
    s.step();
    const v = s.world.survival!.vitals['body-weight-kg'];
    v[eid(s)] = 100;
    minute(s, 1000);
    minute(s, 1000 + 4000);
    expect(traitsOf(s)).not.toContain('base:overweight');
    v[eid(s)] = 90;
    minute(s, 1000 + 4100);
    v[eid(s)] = 100;
    minute(s, 1000 + 4200);
    minute(s, 1000 + 4200 + 4319);
    expect(traitsOf(s)).not.toContain('base:overweight');
    minute(s, 1000 + 4200 + 4320);
    expect(traitsOf(s)).toContain('base:overweight');
    expect(traitsOf(s)).not.toContain('base:athletic');
    // Loses it after a day at or under 88 kg.
    v[eid(s)] = 85;
    minute(s, 20000);
    minute(s, 20000 + 1440);
    expect(traitsOf(s)).not.toContain('base:overweight');
  });

  it('hemophobia goes away after 100 kills', () => {
    const s = sim({ traits: ['base:hemophobic'] });
    s.step();
    expect(traitsOf(s)).toContain('base:hemophobic');
    s.world.ai!.combat.kills[eid(s)] = 100;
    minute(s, 5);
    expect(traitsOf(s)).not.toContain('base:hemophobic');
  });

  it('a save in the middle of a running condition keeps counting (same hash)', () => {
    const s = sim();
    s.step();
    s.world.survival!.vitals['body-weight-kg'][eid(s)] = 100;
    minute(s, 100);
    expect(s.world.items!.traitSince.size).toBe(1);
    const b = sim({ load: s.save() });
    expect(b.hash()).toBe(s.hash());
    b.world.survival!.vitals['body-weight-kg'][eid(b)] = 100;
    minute(b, 100 + 4320);
    expect(traitsOf(b)).toContain('base:overweight');
  });
});
