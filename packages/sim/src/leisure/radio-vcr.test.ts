import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';
import { furnitureActionsView, objectFurnitureId } from '../furniture/menu.js';
import { TileGrid } from '../world/grid.js';

const content = await baseContent();
const leisure = content.worldSettings.survival.leisure;

function sim(objects: { contentId: string; x: number; y: number }[]): Sim {
  return createSim({
    seed: 4,
    map: buildMap({ width: 32, height: 32, objects }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
  });
}
const menu = (s: Sim) =>
  furnitureActionsView(
    s.world,
    new TileGrid(s.world.openings.map, s.world.openings),
    s.world.players.get(0)!,
  );

describe('radio (stage 5)', () => {
  it('listenRadio: needs a radio set in reach and power; a session relaxes', () => {
    const none = sim([]);
    send(none, { type: 'listenRadio' });
    none.step();
    expect(rejectedReasons(none)).toEqual(['no-station']);

    const s = sim([{ contentId: 'base:radio-set', x: 11, y: 10 }]);
    send(s, { type: 'debugStat', stat: 'boredom', value: 60 });
    send(s, { type: 'listenRadio' });
    runMinutes(s, leisure.radio.sessionMin + 1);
    const done = s.drainEvents().find((e) => e.type === 'leisureCompleted');
    expect(done).toMatchObject({ activity: 'radio', boredom: leisure.radio.boredomReduction });
    const radio = menu(s).find((f) => f.furnitureId === objectFurnitureId(11, 10, 0, 0))!;
    expect(radio).toMatchObject({ typeId: 'radio', contentId: 'base:radio-set' });
    expect(radio.actions[0]).toMatchObject({ id: 'listen-radio', enabled: true });

    s.world.items!.powered = false;
    send(s, { type: 'listenRadio' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-power']);
  });
});

describe('VHS through a VCR (stage 5)', () => {
  it('a tape needs TV + VCR (requireVcr); the VCR menu offers watch-vhs:<itemId>', () => {
    const tvOnly = sim([{ contentId: 'base:tv', x: 11, y: 10 }]);
    send(tvOnly, { type: 'debugGiveItem', itemId: 'base:vhs-fitness-workout' });
    tvOnly.step();
    send(tvOnly, { type: 'useItem', item: findItem(tvOnly, 'base:vhs-fitness-workout')!.id });
    tvOnly.step();
    expect(rejectedReasons(tvOnly)).toEqual(['no-station']);

    const s = sim([
      { contentId: 'base:tv', x: 11, y: 10 },
      { contentId: 'base:vcr', x: 10, y: 11 },
    ]);
    send(s, { type: 'debugGiveItem', itemId: 'base:vhs-fitness-workout' });
    s.step();
    const tape = findItem(s, 'base:vhs-fitness-workout')!;
    const vcr = menu(s).find((f) => f.furnitureId === objectFurnitureId(10, 11, 0, 0))!;
    expect(vcr.typeId).toBe('vcr');
    expect(vcr.actions[0]).toMatchObject({
      id: `watch-vhs:${tape.id}`,
      enabled: true,
      labelPl: 'Odtwórz kasetę',
    });
    send(s, {
      type: 'useFurniture',
      furnitureId: vcr.furnitureId,
      actionId: `watch-vhs:${tape.id}`,
    });
    s.step();
    expect(s.getAction()).toMatchObject({ kind: 'watch' });
  });
});

describe('reading on a bed / seat (stage 5)', () => {
  it('read:<itemId> for each carried book kind', () => {
    const s = sim([{ contentId: 'base:bed', x: 11, y: 10 }]);
    send(s, { type: 'debugGiveItem', itemId: 'base:mag-backyard-survival' });
    s.step();
    const mag = findItem(s, 'base:mag-backyard-survival')!;
    const bed = menu(s).find((f) => f.furnitureId === objectFurnitureId(11, 10, 0, 0))!;
    expect(bed.actions.find((a) => a.id === `read:${mag.id}`)).toMatchObject({
      enabled: true,
      labelPl: 'Czytaj',
    });
  });
});
