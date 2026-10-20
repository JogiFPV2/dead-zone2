import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem } from '../test/item-fixtures.js';
import { objectFurnitureId } from '../furniture/menu.js';
import { MEDICINE_REDUCE_SICKNESS, POISONING, SPOILED_POISON_LOAD } from './poisoning.js';

const content = await baseContent();
const DIRTY = 'base:dirty-water-bottle';
const TOILET = { contentId: 'base:toilet', x: 11, y: 10 };
const TOILET_ID = objectFurnitureId(TOILET.x, TOILET.y, 0, 0);

/** Content with the dirty bottle's `sicknessChance` set (1 = always, 0 = never). */
function withChance(chance: number): typeof content {
  const d = content.items[DIRTY]!;
  if (d.kind !== 'drink') throw new Error('dirty bottle is a drink');
  return {
    ...content,
    items: {
      ...content.items,
      [DIRTY]: {
        ...d,
        drink: { ...d.drink, perUse: { ...d.drink.perUse, sicknessChance: chance } },
      },
    },
  };
}

function sim(c: typeof content = content, load?: Uint8Array): Sim {
  return createSim({
    seed: 21,
    map: buildMap({ width: 32, height: 32, objects: [TOILET] }),
    spawn: { x: 10.5, y: 10.5 },
    content: c,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(load ? { load } : {}),
  });
}
const eid = (s: Sim) => s.world.players.get(0)!;
const sv = (s: Sim) => s.world.survival!;
const sickness = (s: Sim) => sv(s).vitals.sickness[eid(s)] ?? 0;
function drinkDirty(s: Sim): void {
  send(s, { type: 'debugGiveItem', itemId: DIRTY });
  s.step();
  send(s, { type: 'debugStat', stat: 'thirst', value: 80 });
  send(s, { type: 'useItem', item: findItem(s, DIRTY)!.id });
  runMinutes(s, 2);
}

describe('food poisoning from tainted water', () => {
  it('dirty-water bottle (chance 1): sickness rises to the dose, nausea, then recovers', () => {
    const s = sim(withChance(1));
    drinkDirty(s);
    expect((sv(s).poisonLoad[eid(s)] ?? 0) + (sv(s).poison[eid(s)] ?? 0)).toBeCloseTo(
      POISONING.dose,
      3,
    );
    sv(s).vitals.unhappiness[eid(s)] = 0;
    runMinutes(s, 100);
    expect(sickness(s)).toBeGreaterThan(POISONING.dose - 3);
    expect(sickness(s)).toBeLessThanOrEqual(POISONING.dose);
    expect(sv(s).vitals.unhappiness[eid(s)]).toBeGreaterThan(1);
    expect(s.getSurvival()!.moodles['base:sick']).toBeGreaterThanOrEqual(1);
    runMinutes(s, 60 * 10);
    expect(sickness(s)).toBe(0);
    expect(sv(s).poison[eid(s)]).toBe(0);
  });

  it('clean water (chance 0) never poisons; same seed = same rolls, save mid-poisoning keeps the hash', () => {
    const clean = sim(withChance(0));
    drinkDirty(clean);
    runMinutes(clean, 30);
    expect(sv(clean).poisonLoad[eid(clean)] ?? 0).toBe(0);
    expect(sickness(clean)).toBe(0);

    const runs = [sim(), sim()].map((s) => {
      for (let i = 0; i < 5; i++) drinkDirty(s);
      return s;
    });
    const state = (s: Sim) => [sv(s).poisonLoad[eid(s)], sv(s).poison[eid(s)]];
    expect(state(runs[1]!)).toEqual(state(runs[0]!));
    // Default chance 0.4: five drinks with this seed poison at least once, not certainly five times.
    expect(state(runs[0]!)[0]! + state(runs[0]!)[1]!).toBeGreaterThan(0);

    const a = sim(withChance(1));
    drinkDirty(a);
    runMinutes(a, 30);
    const b = sim(withChance(1), a.save());
    expect(b.hash()).toBe(a.hash());
    runMinutes(a, 120);
    runMinutes(b, 120);
    expect(b.hash()).toBe(a.hash());
    expect(sickness(b)).toBe(sickness(a));
  });

  it('tainted tank (toilet, mains off): drinking it rolls the dirty bottle chance', () => {
    const s = sim(withChance(1));
    s.world.items!.water = false;
    send(s, { type: 'debugStat', stat: 'thirst', value: 80 });
    send(s, { type: 'useFurniture', furnitureId: TOILET_ID, actionId: 'drink-tank' });
    runMinutes(s, 3);
    expect(sv(s).poisonLoad[eid(s)]! + sv(s).poison[eid(s)]!).toBeGreaterThan(0);
    const never = sim(withChance(0));
    never.world.items!.water = false;
    send(never, { type: 'debugStat', stat: 'thirst', value: 80 });
    send(never, { type: 'useFurniture', furnitureId: TOILET_ID, actionId: 'drink-tank' });
    runMinutes(never, 3);
    expect(sv(never).poisonLoad[eid(never)]).toBe(0);
  });

  it('heavy poisoning costs health, but never below minHealth', () => {
    const s = sim();
    sv(s).poison[eid(s)] = 100;
    sv(s).poisonLoad[eid(s)] = 100;
    sv(s).vitals.health[eid(s)] = POISONING.minHealth + 1;
    send(s, { type: 'debugStat', stat: 'hunger', value: 80 });
    runMinutes(s, 120);
    expect(sv(s).vitals.health[eid(s)]).toBeGreaterThanOrEqual(POISONING.minHealth - 0.01);
    expect(sv(s).dead[eid(s)]).toBe(0);
  });
});

const POTATO = 'base:potato';
/** Content where the potato (and its `food`) is overridden. */
function withFood(food: Record<string, unknown>): typeof content {
  const d = content.items[POTATO]!;
  if (d.kind !== 'food') throw new Error('potato is food');
  return {
    ...content,
    items: { ...content.items, [POTATO]: { ...d, food: { ...d.food, ...food } } },
  };
}
function eatPotato(s: Sim, rotten: boolean): void {
  send(s, { type: 'debugGiveItem', itemId: POTATO });
  s.step();
  const it = findItem(s, POTATO)!;
  if (rotten) s.world.items!.items.get(it.id)!.ageMin = 1e6;
  send(s, { type: 'debugStat', stat: 'hunger', value: 80 });
  send(s, { type: 'useItem', item: it.id });
  runMinutes(s, 5);
}
const total = (s: Sim) => (sv(s).poisonLoad[eid(s)] ?? 0) + (sv(s).poison[eid(s)] ?? 0);

describe('spoiled food and medicine (docs 9.66)', () => {
  it('rotten food (chance 1) adds spoiledPoisonLoad; fresh food never; chance 0 never', () => {
    const a = sim(withFood({ spoiledSicknessChance: 1 }));
    eatPotato(a, true);
    expect(total(a)).toBeCloseTo(SPOILED_POISON_LOAD, 3);
    const fresh = sim(withFood({ spoiledSicknessChance: 1 }));
    eatPotato(fresh, false);
    expect(total(fresh)).toBe(0);
    const never = sim(withFood({ spoiledSicknessChance: 0 }));
    eatPotato(never, true);
    expect(total(never)).toBe(0);
    const custom = sim(withFood({ spoiledSicknessChance: 1, spoiledPoisonLoad: 40 }));
    eatPotato(custom, true);
    expect(total(custom)).toBeCloseTo(40, 3);
  });

  it('food sicknessChance 1 poisons with the full dose', () => {
    const d = content.items[POTATO]!;
    if (d.kind !== 'food') throw new Error('food');
    const s = sim(withFood({ nutrition: { ...d.food.nutrition, sicknessChance: 1 } }));
    eatPotato(s, false);
    expect(total(s)).toBeCloseTo(POISONING.dose, 3);
  });

  it('default rotten chance 0.25 is deterministic per seed', () => {
    const runs = [sim(), sim()].map((s) => {
      for (let i = 0; i < 8; i++) eatPotato(s, true);
      return total(s);
    });
    expect(runs[1]).toBe(runs[0]);
  });

  it('antibiotics lower sickness gradually over the duration, save keeps the hash', () => {
    const s = sim(withChance(1));
    sv(s).poison[eid(s)] = 50;
    send(s, { type: 'debugGiveItem', itemId: 'base:antibiotics' });
    s.step();
    const pill = findItem(s, 'base:antibiotics')!;
    const uses = pill.uses;
    send(s, { type: 'useItem', item: pill.id });
    s.step();
    expect(findItem(s, 'base:antibiotics')!.uses).toBe(uses! - 1);
    // Content `medicine.reduceSickness` (#291), else the default × potency / 0.5.
    const def = content.items['base:antibiotics']!;
    const m = (def as { medicine?: { reduceSickness?: number } }).medicine;
    const potency = def.kind === 'medical' ? def.medical.potency : 0.5;
    const dose = m?.reduceSickness ?? (MEDICINE_REDUCE_SICKNESS * potency) / 0.5;
    expect(sv(s).medicine[eid(s)]).toBeCloseTo(dose, 3);
    runMinutes(s, 20);
    const mid = sv(s).poison[eid(s)] ?? 0;
    expect(mid).toBeLessThan(50);
    expect(mid).toBeGreaterThan(50 - dose);
    const b = sim(withChance(1), s.save());
    expect(b.hash()).toBe(s.hash());
    runMinutes(s, 60);
    runMinutes(b, 60);
    expect(b.hash()).toBe(s.hash());
    expect(sv(s).medicine[eid(s)]).toBe(0);
    expect(sv(s).poison[eid(s)]).toBeLessThan(50 - dose + 1);
    expect(sickness(s)).toBe(sv(s).poison[eid(s)]);
  });
});
