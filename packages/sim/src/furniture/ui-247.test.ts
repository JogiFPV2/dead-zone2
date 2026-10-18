import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@deadzone/content';
import { createSim, type Sim } from '../sim.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { furnitureActionsView, objectFurnitureId, SLEEP_UNTIL_HOURS } from './menu.js';
import { TileGrid } from '../world/grid.js';
import { setLight } from './lighting.js';
import { switchKeyOf } from '../ai/state.js';
import { openingKey } from '../openings/state.js';
import { namesPlOf } from '../host/worker-host.js';
import { DIRTY_LEVELS, DIRTY_MOODLE } from '../survival/state.js';

/** UI asks from Silnik (#247, protocol 34). */
const base = await baseContent();
const menuOf = (s: Sim, x: number, y: number) =>
  furnitureActionsView(
    s.world,
    new TileGrid(s.world.openings.map, s.world.openings),
    s.world.players.get(0)!,
  ).find((f) => f.furnitureId === objectFurnitureId(x, y, 0, 0))!;

function sim(
  objects: { contentId: string; x: number; y: number }[],
  extra: { content?: ContentBundle; namesPl?: Record<string, string> } = {},
): Sim {
  return createSim({
    seed: 4,
    map: buildMap({ width: 32, height: 32, objects }),
    spawn: { x: 10.5, y: 10.5 },
    content: extra.content ?? base,
    ...(extra.namesPl ? { namesPl: extra.namesPl } : {}),
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
  });
}

describe('UI #247 (protocol 34)', () => {
  it('cook:<recipeId> carries the dish name (namesPl, else the result id) and recipe', () => {
    const s = sim([{ contentId: 'base:range', x: 11, y: 10 }], {
      namesPl: { 'base:baked-potato': 'Pieczony ziemniak' },
    });
    send(s, { type: 'debugGiveItem', itemId: 'base:potato' });
    send(s, { type: 'debugLearnRecipe', recipe: 'base:grill-fish' });
    send(s, { type: 'debugGiveItem', itemId: 'base:fish-fillet' });
    s.step();
    const acts = menuOf(s, 11, 10).actions;
    expect(acts.find((a) => a.id === 'cook:base:bake-potato')).toMatchObject({
      labelPl: 'Pieczony ziemniak',
      recipe: 'base:bake-potato',
    });
    expect(acts.find((a) => a.id === 'cook:base:grill-fish')).toMatchObject({
      labelPl: 'Grilled fish',
      recipe: 'base:grill-fish',
    });
  });

  it('namesPlOf reads i18n/pl.json items from the raw packs (later packs win)', () => {
    expect(
      namesPlOf({
        packs: [
          {
            dir: 'a',
            files: [{ path: 'i18n/pl.json', json: { items: { 'x:a': 'A', 'x:b': 'B' } } }],
          },
          { dir: 'b', files: [{ path: 'i18n/pl.json', json: { items: { 'x:b': 'Bb' } } }] },
          { dir: 'c', files: [{ path: 'items/x.json', json: { items: { 'x:c': 'C' } } }] },
        ],
      }),
    ).toEqual({ 'x:a': 'A', 'x:b': 'Bb' });
  });

  it('bed menu announces sleep-until:<h> for 6/7/8/9/12 with labels', () => {
    const s = sim([{ contentId: 'base:bed', x: 11, y: 10 }]);
    send(s, { type: 'debugStat', stat: 'fatigue', value: 70 });
    s.step();
    const acts = menuOf(s, 11, 10).actions;
    for (const h of SLEEP_UNTIL_HOURS)
      expect(acts.find((a) => a.id === `sleep-until:${h}`)).toMatchObject({
        enabled: true,
        labelPl: `Śpij ${h} godz.`,
      });
    expect(acts.filter((a) => a.id.startsWith('sleep-until:')).map((a) => a.id)).toEqual([
      'sleep-until:morning',
      'sleep-until:6',
      'sleep-until:7',
      'sleep-until:8',
      'sleep-until:9',
      'sleep-until:12',
    ]);
  });

  it('base:dirty fallback (no content moodle): levels 25/50/75/90, view and event', () => {
    expect(base.moodles[DIRTY_MOODLE]).toBeUndefined();
    const s = sim([]);
    const eid = s.world.players.get(0)!;
    s.step();
    s.drainView();
    s.drainEvents();
    const levels: number[] = [];
    for (const d of [10, 25, 49, 50, 80, 95, 0]) {
      s.world.survival!.dirt[eid] = d;
      s.step();
      levels.push(s.getSurvival()!.moodles[DIRTY_MOODLE] ?? 0);
    }
    expect(levels).toEqual([0, 1, 1, 2, 3, 4, 0]);
    expect(DIRTY_LEVELS).toEqual([25, 50, 75, 90]);
    s.world.survival!.dirt[eid] = 60;
    s.step();
    expect(s.drainView()?.player?.moodles).toEqual(
      expect.arrayContaining([{ id: DIRTY_MOODLE, level: 2 }]),
    );
    expect(
      s.drainEvents().filter((e) => e.type === 'moodleChanged' && e.moodle === DIRTY_MOODLE),
    ).toHaveLength(6);
  });

  it('base:dirty from content (stat dirt) uses its thresholds instead of the fallback', () => {
    const content = {
      ...base,
      moodles: {
        ...base.moodles,
        [DIRTY_MOODLE]: {
          ...base.moodles['base:boredom']!,
          id: DIRTY_MOODLE,
          stat: 'dirt',
          levels: base.moodles['base:boredom']!.levels.map((l, i) => ({
            ...l,
            enterAt: [10, 20, 30, 40][i]!,
            exitAt: [10, 20, 30, 40][i]!,
            modifiers: [],
          })),
        },
      },
    } as unknown as ContentBundle;
    const s = sim([], { content });
    const eid = s.world.players.get(0)!;
    s.world.survival!.dirt[eid] = 22;
    s.step();
    expect(s.getSurvival()!.moodles[DIRTY_MOODLE]).toBe(2);
    expect(s.world.survival!.dirtyLevel[eid]).toBe(0);
  });
});

describe('litWindows view (protocol 34)', () => {
  const content: ContentBundle = {
    ...base,
    items: {
      ...base.items,
      'test:light-switch': {
        id: 'test:light-switch',
        name: 'item.test.light-switch.name',
        kind: 'placeable',
        weightKg: 0.1,
        tags: ['base:light-switch'],
        placeable: {},
      },
    } as unknown as ContentBundle['items'],
  };
  const inRoom = (x: number, y: number) => x >= 8 && x <= 13 && y >= 16 && y <= 21;
  const mk = (spawn: { x: number; y: number }) =>
    createSim({
      seed: 7,
      map: buildMap({
        width: 128,
        height: 128,
        wallN: (x, y) => x >= 8 && x <= 13 && (y === 16 || y === 22),
        wallW: (x, y) => y >= 16 && y <= 21 && (x === 8 || x === 14),
        edgeId: (x, y) => (x === 10 && y === 16 ? 2 : 1),
        edgeKinds: [null, 'wall', 'window'],
        room: (x, y) => (inRoom(x, y) ? 1 : 0),
        rooms: { '1': 'base:room-living' },
        roomBuildings: { '1': 1 },
        objects: [
          { contentId: 'base:ceiling-lamp', x: 10, y: 18 },
          { contentId: 'test:light-switch', x: 13, y: 21 },
        ],
      }),
      spawn,
      content,
      dev: true,
      clockStart: { day: 1, hour: 23, minute: 0 },
    });
  const steps = (s: Sim, n: number) => {
    let lit;
    for (let i = 0; i < n; i++) {
      s.step();
      const v = s.drainView();
      if (v?.litWindows) lit = v.litWindows;
    }
    return lit;
  };

  it('lists the lit window edge near the player; empty again when the light goes off', () => {
    const s = mk({ x: 28.5, y: 28.5 });
    const key = switchKeyOf(13, 21, 0);
    setLight(s.world, key, true);
    expect(steps(s, 12)).toEqual([{ edge: openingKey(0, 10, 16, 0), x: 10.5, y: 16, z: 0 }]);
    setLight(s.world, key, false);
    expect(steps(s, 12)).toEqual([]);
  });

  it('nothing beyond LIT_WINDOWS_RANGE_TILES', () => {
    const s = mk({ x: 100.5, y: 100.5 });
    setLight(s.world, switchKeyOf(13, 21, 0), true);
    expect(steps(s, 12)).toBeUndefined();
  });
});
