import { describe, expect, it } from 'vitest';
import { fixtureContent, runMinutes, send } from '../test/content-fixtures.js';
import { findItem, itemsSim, rejectedReasons, worldContainer } from '../test/item-fixtures.js';

const WEAPON = 'fixture:bat';

/** Searches the cabinet next to the spawn and returns its id. */
function searched() {
  const sim = itemsSim();
  const cab = worldContainer(sim, 11, 10);
  send(sim, { type: 'openContainer', container: cab.id });
  runMinutes(sim, 3);
  return { sim, cab: cab.id };
}

describe('storage window: takeItem / takeAll / putItem, fill markers', () => {
  it('fillPct before the search predicts the generated loot; storages list in range', () => {
    const sim = itemsSim();
    sim.step();
    const v = sim.drainView()!;
    const cab = worldContainer(sim, 11, 10);
    const marker = v.storages!.find((s) => s.id === cab.id)!;
    expect(marker).toMatchObject({ type: 'fixture:cabinet', searched: false, x: 11, y: 10 });
    expect(v.nearby!.find((n) => n.id === cab.id)!.fillPct).toBe(marker.fillPct);
    // The far cabinet (40, 40) is outside STORAGE_MARKER_TILES.
    expect(v.storages!.some((s) => s.x === 40)).toBe(false);
    send(sim, { type: 'openContainer', container: cab.id });
    runMinutes(sim, 3);
    const after = worldContainer(sim, 11, 10);
    const kg = after.items.reduce((s, i) => s + i.weightKg, 0);
    expect(marker.fillPct).toBe(Math.round(Math.min(1, kg / after.capacityKg!) * 20) / 20);
    expect(sim.drainView()!.storages!.find((s) => s.id === cab.id)!.searched).toBe(true);
  });

  it('takeItem moves one item (or count) from the container into the inventory', () => {
    const { sim, cab } = searched();
    const first = worldContainer(sim, 11, 10).items[0]!;
    send(sim, { type: 'takeItem', container: cab, item: first.id, count: 1 });
    sim.step();
    expect(rejectedReasons(sim)).toEqual([]);
    expect(findItem(sim, first.def)).toBeDefined();
    send(sim, { type: 'takeItem', container: cab + 99, item: first.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
  });

  it('takeAll takes what fits and leaves the rest; putItem puts back; fill updates', () => {
    const sim = itemsSim(
      fixtureContent({ carry: { baseCapacityKg: 0.2, hardLimitMultiplier: 1 } }),
    );
    const cab = worldContainer(sim, 11, 10).id;
    send(sim, { type: 'openContainer', container: cab });
    runMinutes(sim, 3);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:bandage' });
    sim.step();
    sim.drainView();
    const before = worldContainer(sim, 11, 10).items.length;
    send(sim, { type: 'takeAll', container: cab });
    sim.step();
    const left = worldContainer(sim, 11, 10).items.length;
    const reasons = rejectedReasons(sim);
    if (left === before) expect(reasons).toEqual(['no-space']);
    else expect(reasons).toEqual([]);
    const bandage = findItem(sim, 'fixture:bandage')!;
    send(sim, { type: 'putItem', container: cab, item: bandage.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual([]);
    expect(worldContainer(sim, 11, 10).items.some((i) => i.def === 'fixture:bandage')).toBe(true);
  });

  it('takeAll with room for everything empties the container', () => {
    const { sim, cab } = searched();
    send(sim, { type: 'takeAll', container: cab });
    sim.step();
    expect(rejectedReasons(sim)).toEqual([]);
    expect(worldContainer(sim, 11, 10).items).toEqual([]);
    expect(sim.drainView()!.storages!.find((s) => s.id === cab)!.fillPct).toBe(0);
    send(sim, { type: 'takeAll', container: cab });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['no-item']);
  });
});

describe('characters view: visible equipment', () => {
  it('empty hands → unarmed; equipping a weapon updates primary and weaponKind', () => {
    const sim = itemsSim();
    sim.step();
    expect(sim.drainView()!.characters).toEqual([
      {
        stableId: 1,
        equippedPrimary: null,
        equippedBack: null,
        weaponKind: 'unarmed',
        twoHanded: false,
        sneaking: false,
        stepNoiseTiles: 0,
      },
    ]);
    send(sim, { type: 'debugGiveItem', itemId: WEAPON });
    sim.step();
    send(sim, { type: 'equip', item: findItem(sim, WEAPON)!.id, slot: 'hand_primary' });
    sim.step();
    const ch = sim.drainView()!.characters![0]!;
    expect(ch.equippedPrimary).toBe(WEAPON);
    expect(ch.weaponKind).not.toBe('unarmed');
    sim.step();
    expect(sim.drainView()?.characters).toBeUndefined();
  });
});
