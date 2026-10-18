import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@deadzone/content';
import { createSim, type Sim } from '../sim.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { zombie } from '../test/ai-fixtures.js';
import { furnitureActionsView, objectFurnitureId } from './menu.js';
import { TileGrid } from '../world/grid.js';
import { lightAt } from '../ai/vision.js';
import { litWindows, setCurtains, setLight } from './lighting.js';
import { switchKeyOf } from '../ai/state.js';
import { openingKey } from '../openings/state.js';

const base = await baseContent();
/** Base content + a test light switch (no icon needed: test only). */
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
const lure = base.worldSettings.lighting.lure;

// Room 1 (building 1): x 8..13, y 16..21; window in the north wall at (10, 16).
const inRoom = (x: number, y: number) => x >= 8 && x <= 13 && y >= 16 && y <= 21;
const SWITCH = { x: 13, y: 21 };
const LAMP = { x: 10, y: 18 };
const WINDOW = openingKey(0, 10, 16, 0);

function sim(opts: {
  hour: number;
  spawn?: { x: number; y: number };
  zombies?: boolean;
  load?: Uint8Array;
}): Sim {
  return createSim({
    seed: 7,
    map: buildMap({
      width: 32,
      height: 32,
      wallN: (x, y) => x >= 8 && x <= 13 && (y === 16 || y === 22),
      wallW: (x, y) => y >= 16 && y <= 21 && (x === 8 || x === 14),
      edgeId: (x, y) => (x === 10 && y === 16 ? 2 : 1),
      edgeKinds: [null, 'wall', 'window'],
      room: (x, y) => (inRoom(x, y) ? 1 : 0),
      rooms: { '1': 'base:room-living' },
      roomBuildings: { '1': 1 },
      objects: [
        { contentId: 'base:ceiling-lamp', ...LAMP },
        { contentId: 'test:light-switch', ...SWITCH },
      ],
    }),
    spawn: opts.spawn ?? { x: 28.5, y: 28.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: opts.hour, minute: 0 },
    ...(opts.zombies ? { spawnZombies: [{ x: 10.5, y: 3.5 }] } : {}),
    ...(opts.load ? { load: opts.load } : {}),
  });
}
const key = switchKeyOf(SWITCH.x, SWITCH.y, 0);
const steps = (s: Sim, n: number) => {
  for (let i = 0; i < n; i++) s.step();
};

describe('room lights, curtains, lit windows (stage 7)', () => {
  it('a switch turns its room lamps on; power is still needed', () => {
    const s = sim({ hour: 23 });
    const ai = s.world.ai!;
    expect(lightAt(s.world, ai, 10.5, 18.5, 0)).toBe(0);
    setLight(s.world, key, true);
    expect(lightAt(s.world, ai, 10.5, 18.5, 0)).toBeCloseTo(0.8);
    s.world.items!.powered = false;
    expect(lightAt(s.world, ai, 10.5, 18.5, 0)).toBe(0);
  });

  it('menu: switch light-on / light-off, window close-curtains; view and save keep them', () => {
    const s = sim({ hour: 12, spawn: { x: 12.5, y: 20.5 } });
    const grid = new TileGrid(s.world.openings.map, s.world.openings);
    const eid = s.world.players.get(0)!;
    const sw = furnitureActionsView(s.world, grid, eid).find(
      (f) => f.furnitureId === objectFurnitureId(SWITCH.x, SWITCH.y, 0, 0),
    )!;
    expect(sw).toMatchObject({ typeId: 'light-switch' });
    expect(sw.actions[0]).toMatchObject({
      id: 'light-on',
      enabled: true,
      labelPl: 'Zapal światło',
    });
    send(s, { type: 'useFurniture', furnitureId: sw.furnitureId, actionId: 'light-on' });
    s.step();
    expect(s.world.openings.lightsOn.has(key)).toBe(true);
    expect(s.drainView()?.lightsOn).toEqual([{ x: SWITCH.x, y: SWITCH.y, z: 0 }]);

    setCurtains(s.world, WINDOW, true);
    s.step();
    const win = s.drainView()?.openings?.find((o) => o.tx === 10 && o.ty === 16);
    expect(win).toMatchObject({ kind: 'window', curtains: true });

    const back = sim({ hour: 12, spawn: { x: 12.5, y: 20.5 }, load: s.save() });
    expect(back.world.openings.lightsOn.has(key)).toBe(true);
    expect(back.world.openings.curtains.has(WINDOW)).toBe(true);
    expect(back.hash()).toBe(s.hash());
  });

  it('window menu offers close-curtains next to the window', () => {
    const s = sim({ hour: 12, spawn: { x: 10.5, y: 16.6 } });
    const grid = new TileGrid(s.world.openings.map, s.world.openings);
    const menu = furnitureActionsView(s.world, grid, s.world.players.get(0)!);
    const win = menu.find((f) => f.actions.some((a) => a.id === 'close-curtains'));
    expect(win?.actions.find((a) => a.id === 'close-curtains')).toMatchObject({
      enabled: true,
      labelPl: 'Zasłoń okno',
    });
  });

  it('at night a lit window lures a zombie; curtains or daylight do not', () => {
    const lit = sim({ hour: 23, zombies: true });
    setLight(lit.world, key, true);
    expect(litWindows(lit.world).map((w) => [w.x, w.y])).toEqual([[10.5, 15.5]]);
    steps(lit, 100);
    expect(zombie(lit).state).toBe('investigate');
    expect(lit.drainEvents().some((e) => e.type === 'noise' && e.source === 'light')).toBe(true);
    expect(lure.radiusTiles).toBeGreaterThan(12);

    const curtained = sim({ hour: 23, zombies: true });
    setLight(curtained.world, key, true);
    setCurtains(curtained.world, WINDOW, true);
    expect(litWindows(curtained.world)).toEqual([]);
    steps(curtained, 100);
    expect(zombie(curtained).state).not.toBe('investigate');

    const day = sim({ hour: 12, zombies: true });
    setLight(day.world, key, true);
    steps(day, 100);
    expect(zombie(day).state).not.toBe('investigate');
  });
});
