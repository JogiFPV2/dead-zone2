import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { createSim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';
import { addPieces } from '../items/actions.js';
import { groundPile } from '../items/store.js';
import { addXp } from '../progress/skills.js';
import { craftingView } from './crafting.js';

const content = await baseContent();

function sim(load?: Uint8Array): Sim {
  return createSim({
    seed: 5,
    map: buildMap({ width: 64, height: 64 }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(load ? { load } : {}),
  });
}

const give = (s: Sim, itemId: string, count = 1) =>
  send(s, { type: 'debugGiveItem', itemId, count });
const skill = (s: Sim, id: string, level: number) =>
  send(s, { type: 'debugSkill', skill: id, level });
const learn = (s: Sim, recipe: string) => send(s, { type: 'debugLearnRecipe', recipe });

/** Puts items on the ground pile of tile (x, y) (as if dropped there). */
function onGround(s: Sim, x: number, y: number, id: string, count = 1): number {
  const st = s.world.items!;
  const pile = groundPile(st, x, y, 0);
  addPieces(st, st.content.itemIndex.get(id)!, pile.id, count, 0);
  return pile.id;
}

/** Current crafting view of player 0 (the tracker only sends changes). */
const probe = (s: Sim) => craftingView(s.world, s.world.players.get(0)!)!;
const recipe = (s: Sim, id: string) => probe(s).recipes.find((r) => r.id === id)!;

/** Steps until a `crafted` event (or a rejection / interruption); returns all events. */
function untilCrafted(s: Sim, limit = 20000): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < limit; i++) {
    s.step();
    const ev = s.drainEvents();
    all.push(...ev);
    if (ev.some((e) => ['crafted', 'commandRejected', 'actionInterrupted'].includes(e.type)))
      return all;
  }
  return all;
}

describe('crafting: combine', () => {
  it('rags → bandage: missing parts, then available; inventory marks combinable items', () => {
    const s = sim();
    give(s, 'base:rag');
    s.step();
    let r = recipe(s, 'base:make-bandage');
    expect(r).toMatchObject({
      kind: 'combine',
      state: 'missingParts',
      parts: [{ tag: 'base:rag', have: 1, need: 2 }],
    });
    expect(findItem(s, 'base:rag')!.combine).toMatchObject({ ready: false });
    expect(findItem(s, 'base:rag')!.combine!.recipes).toContain('base:make-bandage');
    give(s, 'base:rag');
    s.step();
    r = recipe(s, 'base:make-bandage');
    expect(r.state).toBe('available');
    expect(findItem(s, 'base:rag')!.combine!.ready).toBe(true);
    send(s, { type: 'combine', items: [findItem(s, 'base:rag')!.id] });
    s.step();
    expect(s.getAction()).toMatchObject({ kind: 'craft', recipe: 'base:make-bandage' });
    const ev = untilCrafted(s);
    expect(eventsOf(ev, 'crafted')).toEqual([
      expect.objectContaining({
        recipe: 'base:make-bandage',
        results: [{ def: 'base:bandage', count: 1 }],
      }),
    ]);
    expect(findItem(s, 'base:rag')).toBeUndefined();
    expect(findItem(s, 'base:bandage')).toBeDefined();
  });

  it('parts lying within 3 tiles count; farther ones do not', () => {
    const s = sim();
    onGround(s, 12, 10, 'base:rag', 2); // 2 tiles away
    s.step();
    expect(recipe(s, 'base:make-bandage').state).toBe('available');
    const s2 = sim();
    onGround(s2, 15, 10, 'base:rag', 2); // 5 tiles away
    s2.step();
    expect(recipe(s2, 'base:make-bandage').state).toBe('missingParts');
    send(s2, { type: 'craft', recipe: 'base:make-bandage' });
    s2.step();
    expect(rejectedReasons(s2)).toEqual(['missing-parts']);
    // Crafting from the ground pile consumes it there.
    send(s, { type: 'craft', recipe: 'base:make-bandage' });
    expect(eventsOf(untilCrafted(s), 'crafted')).toHaveLength(1);
    expect(s.world.items!.ground.size).toBe(0);
  });

  it('skill lock, tool requirement, XP and level-up', () => {
    const s = sim();
    give(s, 'base:wooden-stick');
    give(s, 'base:nails', 5);
    give(s, 'base:duct-tape');
    s.step();
    expect(recipe(s, 'base:craft-nailed-stick')).toMatchObject({
      state: 'skillLocked',
      skills: [{ skill: 'base:carpentry', need: 1, have: 0 }],
    });
    send(s, { type: 'craft', recipe: 'base:craft-nailed-stick' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['skill-too-low']);
    skill(s, 'base:carpentry', 1);
    s.step();
    expect(recipe(s, 'base:craft-nailed-stick').state).toBe('missingParts');
    send(s, { type: 'craft', recipe: 'base:craft-nailed-stick' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['missing-tool']);
    give(s, 'base:hammer');
    s.step();
    send(s, { type: 'craft', recipe: 'base:craft-nailed-stick' });
    const ev = untilCrafted(s);
    expect(eventsOf(ev, 'crafted')).toHaveLength(1);
    expect(findItem(s, 'base:nailed-stick')).toBeDefined();
    expect(findItem(s, 'base:hammer')).toBeDefined(); // tool kept (worn)
    const blunt = s.drainView()?.skills?.find((k) => k.id === 'base:blunt');
    expect(blunt).toMatchObject({ level: 0, xp: 1, next: 50 });
    // Level-up from XP.
    addXp(s.world, s.world.players.get(0)!, 'base:blunt', 60);
    expect(s.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'skillLevelUp', skill: 'base:blunt', level: 1 }),
    );
  });
});

describe('crafting: stations', () => {
  const workbenchParts = (s: Sim) => {
    give(s, 'base:plank', 6);
    give(s, 'base:nails', 12);
    give(s, 'base:hammer');
    give(s, 'base:saw');
  };

  it('learned recipe builds a workbench on the ground; station recipes need it nearby', () => {
    const s = sim();
    workbenchParts(s);
    s.step();
    send(s, { type: 'craft', recipe: 'base:build-workbench' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['not-learned']);
    expect(recipe(s, 'base:build-workbench').state).toBe('notLearned');
    learn(s, 'base:build-workbench');
    skill(s, 'base:carpentry', 3);
    s.step();
    expect(eventsOf(s.drainEvents(), 'recipeLearned')).toHaveLength(1);
    send(s, { type: 'craft', recipe: 'base:build-workbench' });
    const ev = untilCrafted(s);
    const done = eventsOf(ev, 'crafted')[0]!;
    expect(done.container).toBeGreaterThan(0);
    expect(s.getContainer(done.container!)!.items.map((i) => i.def)).toEqual(['base:workbench']);
    expect(probe(s).stations).toEqual([
      {
        id: 'base:station-workbench',
        level: 1,
        x: 10,
        y: 10,
        upgrade: 'base:upgrade-carpentry-table',
      },
    ]);
    // Wooden crate: needs the workbench (level 1) — there now.
    learn(s, 'base:wooden-crate');
    give(s, 'base:plank', 4);
    give(s, 'base:nails', 8);
    s.step();
    const crate = recipe(s, 'base:wooden-crate');
    expect(crate).toMatchObject({
      state: 'available',
      station: { id: 'base:station-workbench', minLevel: 1, level: 1 },
    });
    // Level 2 recipe stays locked by the station level.
    skill(s, 'base:carpentry', 4);
    s.step();
    expect(recipe(s, 'base:reinforced-barricade')).toMatchObject({
      state: 'stationLevelLocked',
      station: { minLevel: 2, level: 1 },
    });
  });

  it('no station nearby: no-station', () => {
    const s = sim();
    learn(s, 'base:wooden-crate');
    skill(s, 'base:carpentry', 2);
    give(s, 'base:plank', 4);
    give(s, 'base:nails', 8);
    give(s, 'base:hammer');
    s.step();
    send(s, { type: 'craft', recipe: 'base:wooden-crate' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-station']);
  });

  it('upgradeStation: workbench on the ground → carpentry table on the same tile', () => {
    const s = sim();
    onGround(s, 11, 10, 'base:workbench');
    skill(s, 'base:carpentry', 4);
    give(s, 'base:plank', 6);
    give(s, 'base:nails', 16);
    give(s, 'base:metal-sheet');
    give(s, 'base:hammer');
    give(s, 'base:saw');
    s.step();
    send(s, { type: 'upgradeStation', x: 12, y: 10 });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-station']);
    send(s, { type: 'upgradeStation', x: 11, y: 10 });
    const ev = untilCrafted(s);
    expect(eventsOf(ev, 'crafted')[0]).toMatchObject({ recipe: 'base:upgrade-carpentry-table' });
    expect(probe(s).stations).toEqual([
      expect.objectContaining({ id: 'base:station-workbench', level: 2, x: 11, y: 10 }),
    ]);
    expect(findItem(s, 'base:plank')).toBeUndefined();
  });
});

describe('crafting: learning, repair, save', () => {
  it('reading a recipe magazine learns its recipes', () => {
    const s = sim();
    give(s, 'base:mag-backyard-survival');
    s.step();
    send(s, { type: 'useItem', item: findItem(s, 'base:mag-backyard-survival')!.id });
    const all: SimEvent[] = [];
    for (let i = 0; i < 5000 && !all.some((e) => e.type === 'actionCompleted'); i++) {
      s.step();
      all.push(...s.drainEvents());
    }
    expect(eventsOf(all, 'recipeLearned').map((e) => e.recipe)).toEqual([
      'base:build-rain-collector',
      'base:sew-sheet-rope',
    ]);
    expect(recipe(s, 'base:sew-sheet-rope').state).not.toBe('notLearned');
  });

  it('tape repairs a damaged bat (combine with the bat selected)', () => {
    const s = sim();
    give(s, 'base:baseball-bat');
    give(s, 'base:duct-tape');
    s.step();
    const bat = s.world.items!.items.get(findItem(s, 'base:baseball-bat')!.id)!;
    const max = bat.condition;
    bat.condition = 1;
    s.world.items!.version++;
    send(s, {
      type: 'combine',
      items: [findItem(s, 'base:duct-tape')!.id, bat.id],
      recipe: 'base:tape-repair-bat',
    });
    expect(eventsOf(untilCrafted(s), 'crafted')).toHaveLength(1);
    expect(bat.condition).toBe(Math.min(max, 1 + Math.ceil(max * 0.25)));
    expect(findItem(s, 'base:duct-tape')).toBeUndefined();
  });

  it('skills and learned recipes survive save/load (same hash)', () => {
    const s = sim();
    skill(s, 'base:carpentry', 4);
    learn(s, 'base:build-workbench');
    s.step();
    const b = sim(s.save());
    s.step();
    b.step();
    expect(b.hash()).toBe(s.hash());
    expect(probe(b).recipes.find((r) => r.id === 'base:build-workbench')!.state).not.toBe(
      'notLearned',
    );
    expect(b.drainView()?.skills?.find((k) => k.id === 'base:carpentry')?.level).toBe(4);
  });
});
