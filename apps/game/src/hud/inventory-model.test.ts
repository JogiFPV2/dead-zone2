import type { ContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import { EMPTY_HUD_CONTENT } from './content-index.js';
import {
  formatKg,
  inventoryVM,
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
  it('builds panels', () => {
    const vm = inventoryVM(s, EMPTY_HUD_CONTENT);
    expect(vm.own[0]?.title).toBe('Przy sobie');
    expect(vm.own[0]?.rows[0]?.name).toBe('Canned beans ×2');
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
