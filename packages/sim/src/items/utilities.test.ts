import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf } from '../test/ai-fixtures.js';
import { fixtureContent, runMinutes, send } from '../test/content-fixtures.js';
import { findItem, itemsSim, worldContainer } from '../test/item-fixtures.js';
import { dayOf, MINUTES_PER_DAY } from '../core/clock.js';
import { buildMap } from '../test/fixtures.js';
import { ageAt, isFrozen, restamp, thawLeftMin } from './spoilage.js';
import { setPower, utilitiesSystem } from './utilities.js';
import { saveItemThawSchema, saveUtilitiesSchema } from '@deadzone/protocol/schema';

describe('mains power / water shutoff (worldSettings.utilities)', () => {
  it('rolls the off days from the seed within offAfterDays, counted from the start day', () => {
    const content = fixtureContent({
      utilities: { power: { offAfterDays: { min: 3, max: 5 } }, water: { enabled: false } },
    });
    const a = itemsSim(content, { clockStart: { day: 10, hour: 9, minute: 0 } });
    const b = itemsSim(content, { clockStart: { day: 10, hour: 9, minute: 0 } });
    const st = a.world.items!;
    expect(st.powerOffDay).toBeGreaterThanOrEqual(13);
    expect(st.powerOffDay).toBeLessThanOrEqual(15);
    expect(b.world.items!.powerOffDay).toBe(st.powerOffDay);
    expect(st.waterOffDay).toBe(0);
    expect(a.drainView()?.utilities).toEqual({ power: true, water: true, powerSource: 'grid' });
    expect(a.drainView()?.utilities).toBeUndefined();
  });

  it('power off: event + view, fridge food keeps its cold age then spoils at ×1', () => {
    const sim = itemsSim(fixtureContent({ utilities: { water: { enabled: false } } }));
    sim.drainView();
    const fridge = worldContainer(sim, 9, 10);
    send(sim, { type: 'openContainer', container: fridge.id });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    runMinutes(sim, 1.5);
    const st = sim.world.items!;
    const id = findItem(sim, 'fixture:apple')!.id;
    send(sim, { type: 'moveItem', item: id, to: fridge.id });
    sim.step();
    const apple = st.items.get(id)!;
    const t = apple.ageStamp;
    const before = apple.ageMin;
    runMinutes(sim, 100);
    // Power goes off today.
    const now = sim.gameTime().minute;
    st.powerOffDay = dayOf(now);
    utilitiesSystem(sim.world);
    expect(st.powered).toBe(false);
    expect(eventsOf(sim.drainEvents(), 'utilityChanged')).toEqual([
      { type: 'utilityChanged', tick: sim.world.tick, utility: 'power', on: false },
    ]);
    // Re-stamped: the 100+ min in the cold count ×0.3, from now on ×1.
    expect(apple.ageStamp).toBe(now);
    expect(apple.ageMin).toBeCloseTo(before + 0.3 * (now - t), 3);
    expect(ageAt(st, apple, now + 50)).toBeCloseTo(apple.ageMin + 50, 3);
    expect(sim.drainView()?.utilities).toEqual({ power: false, water: true, powerSource: null });
  });

  it('runs on its own on the rolled day; water off too; survives a save', () => {
    const content = fixtureContent({
      utilities: {
        power: { offAfterDays: { min: 1, max: 1 } },
        water: { offAfterDays: { min: 1, max: 1 } },
      },
    });
    const sim = itemsSim(content, { clockStart: { day: 1, hour: 23, minute: 50 } });
    const st = sim.world.items!;
    expect([st.powerOffDay, st.waterOffDay]).toEqual([2, 2]);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 50_000 && st.water; i++) {
      sim.step();
      ev.push(...sim.drainEvents());
    }
    expect(st.powered).toBe(false);
    expect(st.water).toBe(false);
    expect(eventsOf(ev, 'utilityChanged').map((e) => e.utility)).toEqual(['power', 'water']);
    expect(dayOf(sim.gameTime().minute)).toBe(2);
    expect(sim.gameTime().minute).toBeLessThan(2 * MINUTES_PER_DAY);
    const back = itemsSim(content, {
      clockStart: { day: 1, hour: 23, minute: 50 },
      load: sim.save(),
    });
    expect(back.world.items!.water).toBe(false);
    expect(back.world.items!.powered).toBe(false);
    expect(back.hash()).toBe(sim.hash());
  });
});

describe('freezer: frozen food, thawing without power', () => {
  const fridgeFreezerSim = () =>
    itemsSim(fixtureContent({ utilities: { water: { enabled: false } } }), {
      map: buildMap({ objects: [{ contentId: 'fixture:icebox', x: 9, y: 10 }] }),
    });

  it('a fridge-freezer (`compartments`) = two storages on its tile', () => {
    const sim = fridgeFreezerSim();
    const st = sim.world.items!;
    const types = [...st.containers.values()]
      .filter((c) => c.kind === 'world')
      .map((c) => st.content.containerTypes[c.type]!.id);
    expect(types).toEqual(['fixture:icebox', 'fixture:icebox-freezer']);
  });

  it('freezes after freezeAfterMin, thaws thawMin after the power goes off, then spoils ×1', () => {
    const sim = fridgeFreezerSim();
    const st = sim.world.items!;
    const freezer = [...st.containers.values()].find(
      (c) => st.content.containerTypes[c.type]?.category === 'freezer',
    )!;
    send(sim, { type: 'openContainer', container: freezer.id });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    runMinutes(sim, 1.5);
    const id = findItem(sim, 'fixture:apple')!.id;
    send(sim, { type: 'moveItem', item: id, to: freezer.id });
    sim.step();
    const apple = st.items.get(id)!;
    const t0 = apple.ageStamp;
    const before = apple.ageMin;
    expect(isFrozen(st, apple, t0 + 359)).toBe(false);
    expect(isFrozen(st, apple, t0 + 360)).toBe(true);
    // Power off at t0 + 400: frozen solid → thaws for 720 min at ×0.05, then ×1.
    const off = t0 + 400;
    setPower(st, false, off);
    expect(apple.thawUntil).toBe(off + 720);
    expect(isFrozen(st, apple, off + 719)).toBe(true);
    expect(isFrozen(st, apple, off + 720)).toBe(false);
    expect(thawLeftMin(st, apple, off + 20)).toBe(700);
    const a0 = apple.ageMin;
    expect(a0).toBeCloseTo(before + 400 * 0.05, 3);
    expect(ageAt(st, apple, off + 720 + 100)).toBeCloseTo(a0 + 720 * 0.05 + 100, 3);
    // Moving a thawing item keeps its thaw end.
    restamp(st, apple, off + 30);
    expect(apple.thawUntil).toBe(off + 720);
    restamp(st, apple, off + 800);
    expect(apple.thawUntil).toBeUndefined();
  });

  it('the item view shows frozen / thawMin; save schemas accept the saved fields', () => {
    const sim = fridgeFreezerSim();
    const st = sim.world.items!;
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    sim.step();
    const apple = st.items.get(findItem(sim, 'fixture:apple')!.id)!;
    apple.thawUntil = sim.gameTime().minute + 120;
    st.version++;
    sim.step();
    const v = findItem(sim, 'fixture:apple')!;
    expect(v.frozen).toBe(true);
    expect(v.thawMin).toBeGreaterThan(100);
    expect(saveItemThawSchema.safeParse({ thawUntil: apple.thawUntil }).success).toBe(true);
    const { powered, water, powerOffDay, waterOffDay } = st;
    expect(
      saveUtilitiesSchema.safeParse({ powered, water, powerOffDay, waterOffDay }).success,
    ).toBe(true);
  });
});
