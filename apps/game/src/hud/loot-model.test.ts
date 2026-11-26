import type { ContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import { EMPTY_HUD_CONTENT } from './content-index.js';
import {
  clockLabel,
  containersLabel,
  lootRow,
  lootTabs,
  reachableTabs,
  ownItems,
  putCommand,
  putSelected,
  rangeIds,
  selectionSummary,
  takeCommand,
  takeWithinLimit,
} from './loot-model.js';

const main: ContainerView = {
  id: 1,
  kind: 'inventory',
  capacityKg: null,
  weightKg: 1.3,
  items: [
    { id: 10, def: 'base:canned-beans', count: 2, weightKg: 0.9 },
    { id: 11, def: 'base:kitchen-knife', count: 1, weightKg: 0.25, equipped: ['hand_primary'] },
  ],
};
const bag: ContainerView = {
  id: 2,
  kind: 'bag',
  capacityKg: 10,
  weightKg: 0.5,
  items: [{ id: 12, def: 'base:bandage', count: 3, weightKg: 0.3 }],
};
const fridge: ContainerView = {
  id: 5,
  kind: 'world',
  type: 'base:fridge',
  capacityKg: 20,
  weightKg: 9,
  items: [
    { id: 20, def: 'base:water-bottle', count: 3, weightKg: 1.8, freshness: 'fresh' },
    { id: 21, def: 'base:apple', count: 2, weightKg: 0.4, freshness: 'rotten' },
    { id: 22, def: 'base:crowbar', count: 1, weightKg: 6 },
    { id: 23, def: 'base:apple', count: 1, weightKg: 0.2 },
  ],
};
const s: GameState = {
  ...INITIAL_GAME_STATE,
  inventory: {
    container: 1,
    loadKg: 5,
    capacityKg: 12,
    hardLimitKg: 24,
    carryLoad: 40,
    equipped: { hand_primary: 11 },
    containers: { 1: main, 2: bag },
  },
  container: fridge,
  nearby: [
    { id: 9, kind: 'ground', x: 1, y: 1, z: 0, searched: true },
    { id: 5, kind: 'world', type: 'base:fridge', x: 1, y: 0, z: 0, searched: true },
    { id: 6, kind: 'world', type: 'base:kitchen-cabinet', x: 2, y: 0, z: 0, searched: false },
  ],
};

describe('loot model', () => {
  it('lists own items of the main inventory and bags', () => {
    expect(ownItems(s).map((i) => i.id)).toEqual([10, 11, 12]);
  });

  it('tabs: opened container with its count, ground always last', () => {
    const tabs = lootTabs(s);
    expect(tabs.map((t) => t.label)).toEqual(['Lodówka', 'Szafka kuchenna', 'Podłoga']);
    expect(tabs[0]).toMatchObject({ active: true, count: 4 });
    expect(tabs[1]!.count).toBeUndefined();
  });

  it('tabs: the trunk in reach adds a dashed glovebox tab (vehicle UI)', () => {
    const car: GameState = {
      ...s,
      nearby: [{ id: 30, kind: 'vehicle-trunk', vehicle: 7, x: 4, y: 4, z: 0, searched: true }],
      vehicles: [
        {
          vehicleId: 7,
          type: 'base:sedan',
          locked: false,
          keyInIgnition: false,
          hasKey: false,
          hotwired: false,
          engineOn: false,
          fuel: 10,
          fuelMax: 50,
          trunk: 30,
          glovebox: 31,
        },
      ],
    };
    delete car.container;
    const tabs = lootTabs(car);
    expect(tabs.map((t) => [t.label, t.off])).toEqual([
      ['Bagażnik', undefined],
      ['Schowek', 'tylko z przedniego fotela'],
    ]);
    expect(reachableTabs(car).map((t) => t.id)).toEqual([30]);
  });

  it('LPM takes one piece, Ctrl+LPM the stack', () => {
    expect(takeCommand(s, 20, false)).toEqual({ type: 'pickUp', item: 20, count: 1 });
    expect(takeCommand(s, 20, true)).toEqual({ type: 'pickUp', item: 20 });
    expect(takeCommand(s, 22, false)).toEqual({ type: 'pickUp', item: 22 });
    expect(takeCommand(s, 10, false)).toBeUndefined();
  });

  it('LPM on own rows puts one piece back; equipped items stay', () => {
    expect(putCommand(s, 12, false)).toEqual({ type: 'moveItem', item: 12, to: 5, count: 1 });
    expect(putCommand(s, 10, true)).toEqual({ type: 'moveItem', item: 10, to: 5 });
    expect(putCommand(s, 11, true)).toBeUndefined();
    expect(putSelected(s, [10, 11])).toEqual([{ type: 'moveItem', item: 10, to: 5 }]);
  });

  it('take all stops at the carry limit and counts what is left', () => {
    // 5 + 1.8 + 0.4 = 7.2; crowbar (6) would exceed 12; the apple after it still fits.
    const r = takeWithinLimit(s);
    expect(r.cmds.map((c) => (c.type === 'pickUp' ? c.item : -1))).toEqual([20, 21, 23]);
    expect(r.left).toBe(1);
    expect(takeWithinLimit(s, [22], 24).cmds).toHaveLength(1);
  });

  it('selection summary and Shift ranges', () => {
    expect(selectionSummary(fridge.items, new Set([20, 21]))).toEqual({
      stacks: 2,
      pieces: 5,
      weightKg: 1.8 + 0.4,
    });
    expect(rangeIds([20, 21, 22, 23], 23, 21)).toEqual([21, 22, 23]);
    expect(rangeIds([20, 21], 99, 21)).toEqual([21]);
  });

  it('row: freshness tone and stack tooltip actions', () => {
    const r = lootRow(fridge.items[1]!, EMPTY_HUD_CONTENT);
    expect(r).toMatchObject({ name: 'Jabłko', freshness: 'rotten', count: 2, sub: 'Zepsute' });
    expect(r.tooltip.actions?.map((a) => a.key)).toEqual(['LPM', 'Ctrl+LPM']);
  });

  it('labels', () => {
    expect(containersLabel(1)).toBe('1 pojemnik');
    expect(containersLabel(3)).toBe('3 pojemniki');
    expect(containersLabel(5)).toBe('5 pojemników');
    expect(clockLabel({ day: 12, minuteOfDay: 21 * 60 + 47 } as GameState['clock'])).toEqual({
      time: '21:47',
      day: 'Dzień 12',
    });
  });
});
