import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { saveSleepSchema, sleepCommandSchema } from '@deadzone/protocol/schema';
import { gameMinuteAt, minuteOfDay } from '../core/clock.js';
import { createSim, type Sim } from '../sim.js';
import { baseContent, fixtureContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';
import { furnitureActionsView, objectFurnitureId } from '../furniture/menu.js';
import { TileGrid } from '../world/grid.js';

const content = fixtureContent();
const cfg = content.worldSettings.survival;

function sim(opts: { hour?: number; load?: Uint8Array; bed?: boolean } = {}): Sim {
  return createSim({
    seed: 3,
    map: buildMap({
      width: 32,
      height: 32,
      objects: opts.bed === false ? [] : [{ contentId: 'fixture:bed', x: 11, y: 10 }],
    }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: opts.hour ?? 22, minute: 0 },
    ...(opts.load ? { load: opts.load } : {}),
  });
}

const woke = (s: Sim): SimEvent[] => s.drainEvents().filter((e) => e.type === 'wokeUp');
const clock = (s: Sim) => {
  const m = gameMinuteAt(s.world.clock, s.tick);
  return { hour: Math.floor(minuteOfDay(m) / 60) };
};

describe('sleep {until} (stage 4)', () => {
  it("'morning': sleeps through rested and wakes at morningHour with reason 'alarm'", () => {
    const s = sim({ hour: 22 });
    send(s, { type: 'debugStat', stat: 'fatigue', value: 40 });
    send(s, { type: 'sleep', until: 'morning' });
    s.step();
    const v = s.drainView()?.player?.sleep;
    expect(v?.wakeAtTick).toBeGreaterThan(0);
    // 9 game hours to 7:00; fatigue reaches the bed cap long before.
    runMinutes(s, 8 * 60 + 50);
    expect(s.getSurvival()!.sleeping).toBe(true);
    runMinutes(s, 15);
    const ev = woke(s);
    expect(ev).toEqual([expect.objectContaining({ reason: 'alarm' })]);
    expect(clock(s)).toMatchObject({ hour: 7 });
  });

  it('hours: alarm after N hours; save → load keeps it (same hash)', () => {
    const s = sim({ hour: 12 });
    send(s, { type: 'debugStat', stat: 'fatigue', value: 50 });
    send(s, { type: 'sleep', until: 2 });
    runMinutes(s, 30);
    const back = sim({ hour: 12, load: s.save() });
    expect(back.hash()).toBe(s.hash());
    runMinutes(back, 95);
    expect(woke(back)).toEqual([expect.objectContaining({ reason: 'alarm' })]);
    expect(clock(back)).toMatchObject({ hour: 14 });
    expect(saveSleepSchema.parse({ sleepUntil: [0, 840] })).toBeTruthy();
    const h = { tick: 0, playerId: 0, seq: 0 };
    expect(sleepCommandSchema.safeParse({ ...h, type: 'sleep', until: 'morning' }).success).toBe(
      true,
    );
    expect(sleepCommandSchema.safeParse({ ...h, type: 'sleep', until: 25 }).success).toBe(false);
  });

  it('not tired → not-tired (also the bed menu entries)', () => {
    const s = sim();
    send(s, { type: 'sleep', until: 'morning' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['not-tired']);
    const eid = s.world.players.get(0)!;
    const menu = furnitureActionsView(
      s.world,
      new TileGrid(s.world.openings.map, s.world.openings),
      eid,
    );
    const bed = menu.find((f) => f.furnitureId === objectFurnitureId(11, 10, 0, 0))!;
    expect(bed.typeId).toBe('bed');
    expect(bed.actions.map((a) => [a.id, a.reason])).toEqual([
      ['sleep', 'not-tired'],
      ['sleep-until:morning', 'not-tired'],
      ['rest', 'not-tired'],
    ]);
    expect(bed.actions[1]!.labelPl).toBe('Śpij do rana');
    send(s, { type: 'debugStat', stat: 'fatigue', value: 50 });
    s.step();
    send(s, { type: 'useFurniture', furnitureId: bed.furnitureId, actionId: 'sleep-until:3' });
    s.step();
    expect(s.drainView()?.player?.sleep?.surface).toBe('bed');
    expect(s.world.survival!.sleepUntil[eid]).toBeGreaterThan(0);
  });
});

describe('rest (stage 4)', () => {
  it('needs fatigue ≥ minFatigue; on a bed / seat full rest, on the floor × floorMul', () => {
    const rest = cfg.leisure.rest;
    for (const bed of [true, false]) {
      const s = sim({ bed });
      send(s, { type: 'rest' });
      s.step();
      expect(rejectedReasons(s)).toEqual(['not-tired']);
      send(s, { type: 'debugStat', stat: 'fatigue', value: 40 });
      send(s, { type: 'rest' });
      runMinutes(s, rest.sessionMin + 1);
      const done = s.drainEvents().find((e) => e.type === 'leisureCompleted');
      expect(done).toMatchObject({
        activity: 'rest',
        fatigue: bed ? rest.fatigueRest : rest.fatigueRest * rest.floorMul,
      });
    }
  });
});

describe('learning only when rested (stage 4)', () => {
  it('skill books and teaching tapes: tired → tired; leisure reading still works', async () => {
    const base = await baseContent();
    const s = createSim({
      seed: 1,
      map: buildMap({ width: 32, height: 32 }),
      spawn: { x: 10.5, y: 10.5 },
      content: base,
      dev: true,
    });
    const max = base.worldSettings.survival.leisure.learning.maxFatigue;
    send(s, { type: 'debugStat', stat: 'fatigue', value: max + 5 });
    send(s, { type: 'debugGiveItem', itemId: 'base:first-aid-vol-1' });
    s.step();
    send(s, { type: 'useItem', item: findItem(s, 'base:first-aid-vol-1')!.id });
    s.step();
    expect(rejectedReasons(s)).toEqual(['tired']);
    send(s, { type: 'debugStat', stat: 'fatigue', value: max - 5 });
    send(s, { type: 'useItem', item: findItem(s, 'base:first-aid-vol-1')!.id });
    s.step();
    expect(rejectedReasons(s)).toEqual([]);
    expect(s.getAction()).toMatchObject({ kind: 'read' });
  });
});
