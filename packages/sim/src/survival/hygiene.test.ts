import { describe, expect, it } from 'vitest';
import { saveHygieneSchema, useWaterCommandSchema } from '@deadzone/protocol/schema';
import { createSim, type Sim } from '../sim.js';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { rejectedReasons } from '../test/item-fixtures.js';
import { furnitureActionsView, objectFurnitureId } from '../furniture/menu.js';
import { TileGrid } from '../world/grid.js';

const content = await baseContent();
const hy = content.worldSettings.survival.hygiene;

const SINK = { contentId: 'base:kitchen-sink', x: 11, y: 10 };
const SHOWER = { contentId: 'base:shower', x: 10, y: 11 };
const BATH = { contentId: 'base:bathtub', x: 9, y: 10 };

function sim(spawn = { x: 10.5, y: 10.5 }, load?: Uint8Array): Sim {
  return createSim({
    seed: 9,
    map: buildMap({ width: 32, height: 32, objects: [SINK, SHOWER, BATH] }),
    spawn,
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(load ? { load } : {}),
  });
}
const eid = (s: Sim) => s.world.players.get(0)!;
const dirt = (s: Sim) => s.world.survival!.dirt[eid(s)] ?? 0;
const vit = (s: Sim) => s.world.survival!.vitals;

describe('hygiene and mains water (stage 8)', () => {
  it('dirt grows by dirtPerHour; very dirty makes unhappy; the view shows it', () => {
    const s = sim();
    runMinutes(s, 60);
    expect(dirt(s)).toBeCloseTo(hy.dirtPerHour, 1);
    s.world.survival!.dirt[eid(s)] = 100;
    vit(s).unhappiness[eid(s)] = 0;
    send(s, { type: 'debugStat', stat: 'boredom', value: 0 });
    runMinutes(s, 60);
    expect(vit(s).unhappiness[eid(s)]).toBeGreaterThan(hy.unhappinessPerHourAtMax * 0.5);
    s.step();
    expect(s.drainView()?.player?.dirt).toBe(100);
  });

  it('sink: wash and drink; shower and bath clean fully; events', () => {
    const s = sim();
    s.world.survival!.dirt[eid(s)] = 60;
    send(s, { type: 'useWater', use: 'wash' });
    runMinutes(s, hy.wash.durationMin + 2);
    expect(dirt(s)).toBeCloseTo(60 - hy.wash.dirt, 0);
    const washed = s.drainEvents().find((e) => e.type === 'washed');
    expect(washed).toMatchObject({ use: 'wash' });

    send(s, { type: 'useWater', use: 'shower' });
    runMinutes(s, hy.shower.durationMin + 2);
    expect(dirt(s)).toBeLessThan(0.5);

    s.world.survival!.dirt[eid(s)] = 80;
    send(s, { type: 'debugStat', stat: 'stress', value: 40 });
    send(s, { type: 'useWater', use: 'bath' });
    runMinutes(s, hy.bath.durationMin + 2);
    expect(dirt(s)).toBeLessThan(0.5);
    expect(vit(s).stress[eid(s)]).toBeLessThan(40 - hy.bath.stress + 5);

    send(s, { type: 'debugStat', stat: 'thirst', value: 50 });
    send(s, { type: 'useWater', use: 'drink' });
    runMinutes(s, hy.drinkTap.durationMin + 1);
    expect(vit(s).thirst[eid(s)]).toBeLessThan(50 - hy.drinkTap.thirst + 2);
  });

  it('no water in the mains: no-water; no fixture in reach: no-station', () => {
    const s = sim();
    s.world.items!.water = false;
    send(s, { type: 'useWater', use: 'shower' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-water']);
    const far = sim({ x: 25.5, y: 25.5 });
    send(far, { type: 'useWater', use: 'wash' });
    far.step();
    expect(rejectedReasons(far)).toEqual(['no-station']);
  });

  it('menu: sink (drink-tap, wash), shower, bath; tags from content', () => {
    const s = sim();
    const menu = furnitureActionsView(
      s.world,
      new TileGrid(s.world.openings.map, s.world.openings),
      eid(s),
    );
    const at = (o: { x: number; y: number }) =>
      menu.find((f) => f.furnitureId === objectFurnitureId(o.x, o.y, 0, 0))!;
    expect(at(SINK).typeId).toBe('sink');
    expect(at(SINK).actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(['drink-tap', 'wash']),
    );
    expect(at(SHOWER)).toMatchObject({ typeId: 'shower' });
    expect(at(SHOWER).actions[0]).toMatchObject({ id: 'shower', labelPl: 'Weź prysznic' });
    expect(at(BATH).actions[0]).toMatchObject({ id: 'bath', durationMin: hy.bath.durationMin });
    s.world.items!.water = false;
    const dry = furnitureActionsView(
      s.world,
      new TileGrid(s.world.openings.map, s.world.openings),
      eid(s),
    ).find((f) => f.furnitureId === objectFurnitureId(BATH.x, BATH.y, 0, 0))!;
    expect(dry.actions[0]).toMatchObject({ enabled: false, reason: 'no-water' });
  });

  it('save keeps dirt (same hash); schemas', () => {
    const s = sim();
    runMinutes(s, 30);
    const back = sim(undefined, s.save());
    expect(dirt(back)).toBe(dirt(s));
    expect(back.hash()).toBe(s.hash());
    expect(saveHygieneSchema.parse({ dirt: [0, 12.5] })).toBeTruthy();
    expect(
      useWaterCommandSchema.safeParse({
        type: 'useWater',
        use: 'bath',
        tick: 0,
        playerId: 0,
        seq: 0,
      }).success,
    ).toBe(true);
    expect(
      useWaterCommandSchema.safeParse({
        type: 'useWater',
        use: 'swim',
        tick: 0,
        playerId: 0,
        seq: 0,
      }).success,
    ).toBe(false);
  });
});
