import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { furnitureActionsView, objectFurnitureId } from './menu.js';
import { TileGrid } from '../world/grid.js';

const content = await baseContent();

function sim(objects: { contentId: string; x: number; y: number }[]): Sim {
  return createSim({
    seed: 3,
    map: buildMap({ width: 32, height: 32, objects }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 22, minute: 0 },
  });
}
const menu = (s: Sim) =>
  furnitureActionsView(
    s.world,
    new TileGrid(s.world.openings.map, s.world.openings),
    s.world.players.get(0)!,
  );
const ids = (s: Sim, x: number, y: number) =>
  menu(s)
    .find((f) => f.furnitureId === objectFurnitureId(x, y, 0, 0))!
    .actions.map((a) => a.id);

describe('bed / sofa / TV menu (base content)', () => {
  it.each(['base:bed', 'base:double-bed', 'base:sofa'])('%s offers sleep and rest', (id) => {
    const s = sim([{ contentId: id, x: 11, y: 10 }]);
    send(s, { type: 'debugStat', stat: 'fatigue', value: 70 });
    s.step();
    const acts = ids(s, 11, 10);
    expect(acts).toEqual(expect.arrayContaining(['sleep', 'sleep-until:morning', 'rest']));
    const f = menu(s).find((x) => x.furnitureId === objectFurnitureId(11, 10, 0, 0))!;
    expect(f.actions.find((a) => a.id === 'sleep')).toMatchObject({
      enabled: true,
      labelPl: 'Śpij',
    });
    expect(f.actions.find((a) => a.id === 'rest')).toMatchObject({
      enabled: true,
      labelPl: 'Odpocznij',
    });
  });

  it('TV without a carried tape: grey insert-tape (missing-item)', () => {
    const s = sim([{ contentId: 'base:tv', x: 11, y: 10 }]);
    const tv = menu(s).find((x) => x.furnitureId === objectFurnitureId(11, 10, 0, 0))!;
    expect(tv.actions.find((a) => a.id === 'insert-tape')).toMatchObject({
      enabled: false,
      reason: 'missing-item',
      labelPl: 'Włóż kasetę',
    });
    send(s, { type: 'debugGiveItem', itemId: 'base:vhs-fitness-workout' });
    s.step();
    const after = menu(s).find((x) => x.furnitureId === objectFurnitureId(11, 10, 0, 0))!;
    expect(after.actions.some((a) => a.id === 'insert-tape')).toBe(false);
    expect(after.actions.some((a) => a.id.startsWith('insert-tape:'))).toBe(true);
  });
});
