import type { ContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import { EMPTY_HUD_CONTENT } from './content-index.js';
import { setItemIcons } from './item-icons.js';
import {
  equipmentVM,
  formatKg,
  inventoryVM,
  itemTooltip,
  moveTo,
  putAll,
  quickTransfer,
  takeAll,
} from './inventory-model.js';

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
const crate: ContainerView = {
  id: 5,
  kind: 'world',
  type: 'base:crate',
  capacityKg: 20,
  weightKg: 1,
  items: [{ id: 20, def: 'base:apple', count: 1, weightKg: 0.2 }],
};
const s: GameState = {
  ...INITIAL_GAME_STATE,
  inventory: {
    container: 1,
    loadKg: 1.3,
    capacityKg: 12,
    hardLimitKg: 24,
    carryLoad: 10,
    equipped: { hand_primary: 11 },
    containers: { 1: main },
  },
  container: crate,
};

describe('inventory model', () => {
  it('equipment slots carry the equipped item with its baked icon', () => {
    setItemIcons(new Map([['base:kitchen-knife', '/icons/kitchen-knife.png']]));
    const eq = equipmentVM(s, EMPTY_HUD_CONTENT);
    expect(eq.map((e) => e.label)).toEqual([
      'Prawa ręka',
      'Lewa ręka',
      'Plecy',
      'Tors',
      'Głowa',
      'Nogi',
      'Stopy',
      'Pas',
    ]);
    expect(eq[0]?.item?.image).toBe('/icons/kitchen-knife.png');
    expect(eq[1]?.item).toBeUndefined();
    setItemIcons(new Map());
  });
  it('tooltip: category, weight, durability, actions', () => {
    const t = itemTooltip(
      { id: 1, def: 'base:crowbar', count: 1, weightKg: 1.6, condition: 6 },
      { id: 'base:crowbar', kind: 'weapon_melee', maxStack: 1, weightKg: 1.6, durabilityMax: 10 },
      'equip',
    );
    expect(t.category).toBe('Broń · Biała');
    expect(t.stats[0]).toEqual({ label: 'Waga', value: '1,6', unit: 'kg' });
    expect(t.stats.at(-1)).toMatchObject({ label: 'Trwałość', value: '6/10', bar: 0.6 });
    expect(t.actions).toEqual([
      { key: 'LPM', label: 'przenieś' },
      { key: 'PPM', label: 'załóż' },
    ]);
  });
  it('builds panels', () => {
    const vm = inventoryVM(s, EMPTY_HUD_CONTENT);
    expect(vm.own[0]?.title).toBe('Przy sobie');
    expect(vm.own[0]?.rows[0]?.name).toBe('Fasola w puszce ×2');
    expect(vm.open?.title).toBe('Skrzynka · schowek');
    expect(formatKg(8.44)).toBe('8,4');
  });
  it('transfers', () => {
    expect(quickTransfer(s, 20)).toEqual({ type: 'pickUp', item: 20 });
    expect(quickTransfer(s, 10)).toEqual({ type: 'moveItem', item: 10, to: 5 });
    expect(quickTransfer(s, 11)).toBeUndefined();
    expect(moveTo(s, 20, 1)).toEqual({ type: 'pickUp', item: 20 });
    expect(moveTo(s, 20, 5)).toBeUndefined();
    expect(takeAll(s)).toEqual([{ type: 'pickUp', item: 20 }]);
    expect(putAll(s)).toEqual([{ type: 'moveItem', item: 10, to: 5 }]);
  });
});

describe('VHS tapes', () => {
  it('PPM plays the tape on the TV nearby', async () => {
    const { contextCommand, itemRow } = await import('./inventory-model.js');
    const content = {
      ...EMPTY_HUD_CONTENT,
      items: new Map([
        ['base:vhs-a', { id: 'base:vhs-a', kind: 'vhs', maxStack: 1, weightKg: 0.25 }],
      ]),
    };
    const tape = { id: 30, def: 'base:vhs-a', count: 1, weightKg: 0.25 };
    expect(itemRow(tape, content.items.get('base:vhs-a')).context).toBe('watch');
    const st: GameState = {
      ...INITIAL_GAME_STATE,
      inventory: {
        container: 1,
        loadKg: 0,
        capacityKg: 12,
        hardLimitKg: 24,
        carryLoad: 0,
        equipped: {},
        containers: {
          1: { id: 1, kind: 'inventory', capacityKg: null, weightKg: 0, items: [tape] },
        },
      },
    };
    expect(contextCommand(st, content, 30)).toEqual({ type: 'watchTv', vhs: 30 });
  });
});
