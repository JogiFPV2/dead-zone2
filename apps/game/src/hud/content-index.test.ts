import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import { buildHudContentIndex } from './content-index.js';
import { equipToSlot } from './inventory-model.js';

const content = buildHudContentIndex([
  {
    path: 'items/weapons.json',
    json: [
      { id: 'x:bat', kind: 'weapon_melee', melee: { category: 'blunt', twoHanded: true } },
      { id: 'x:knife', kind: 'weapon_melee', melee: { category: 'blade' } },
      { id: 'x:shotgun', kind: 'weapon_ranged', ranged: { category: 'shotgun' } },
      { id: 'x:pistol', kind: 'weapon_ranged', ranged: { category: 'pistol' } },
    ],
  },
] as never);

describe('content index: back slot', () => {
  it('two-handed melee, shotguns and rifles may go on the back', () => {
    expect(content.items.get('x:bat')?.equipSlots).toContain('back');
    expect(content.items.get('x:shotgun')?.equipSlots).toContain('back');
    expect(content.items.get('x:knife')?.equipSlots).not.toContain('back');
    expect(content.items.get('x:pistol')?.equipSlots).not.toContain('back');
  });

  it('equipToSlot sends equip only to an allowed, not yet used slot', () => {
    const s: GameState = {
      ...INITIAL_GAME_STATE,
      inventory: {
        container: 1,
        loadKg: 4,
        capacityKg: 12,
        hardLimitKg: 24,
        carryLoad: 10,
        equipped: {},
        containers: {
          1: {
            id: 1,
            kind: 'inventory',
            capacityKg: null,
            weightKg: 4,
            items: [
              { id: 7, def: 'x:shotgun', count: 1, weightKg: 3 },
              { id: 8, def: 'x:knife', count: 1, weightKg: 0.3, equipped: ['hand_primary'] },
            ],
          },
        },
      },
    };
    expect(equipToSlot(s, content, 7, 'back')).toEqual({ type: 'equip', item: 7, slot: 'back' });
    expect(equipToSlot(s, content, 8, 'back')).toBeUndefined();
    expect(equipToSlot(s, content, 8, 'hand_primary')).toBeUndefined();
    expect(equipToSlot(s, content, 8, 'hand_secondary')).toEqual({
      type: 'equip',
      item: 8,
      slot: 'hand_secondary',
    });
  });
});

describe('content index: vehicles', () => {
  const idx = buildHudContentIndex([
    {
      path: 'world-settings/vehicles.json',
      json: {
        vehicles: {
          enterSec: 1.5,
          hotwire: { sec: 6, minElectrical: 1, baseChance: 0.2, chancePerElectrical: 0.1 },
          fuel: { refuelLps: 1, pumpPoweredLps: 1.5, pumpManualLps: 0.3 },
          repair: {
            skill: 'base:mechanics',
            tire: {
              sec: 10,
              tools: ['base:tool-wrench'],
              parts: [{ item: 'base:car-tire', count: 1 }],
            },
          },
        },
      },
    },
    {
      path: 'vehicle-types/sedan.json',
      json: {
        id: 'base:sedan',
        length: 4.6,
        width: 1.8,
        fuelMax: 50,
        seats: [{ id: 'driver', doorSide: 'left', offset: { x: 0.1, y: -0.4 } }],
        trunkCapacity: 60,
        gloveboxCapacity: 3,
      },
    },
    {
      path: 'items/tools.json',
      json: [{ id: 'x:wrench', kind: 'tool', tags: ['base:tool-wrench'] }],
    },
  ] as never);

  it('reads vehicle settings, types and item tags', () => {
    expect(idx.vehicles?.hotwire).toMatchObject({ sec: 6, minElectrical: 1, maxChance: 1 });
    expect(idx.vehicles?.fuel.pumpManualLps).toBe(0.3);
    expect(idx.vehicles?.repair.tire.parts).toEqual([{ item: 'base:car-tire', count: 1 }]);
    expect(idx.vehicles?.repair.engine.tools).toEqual([]);
    expect(idx.vehicleTypes?.get('base:sedan')).toMatchObject({
      length: 4.6,
      fuelMax: 50,
      trunkCapacity: 60,
      seats: [{ id: 'driver', doorSide: 'left', x: 0.1, y: -0.4 }],
    });
    expect(idx.items.get('x:wrench')?.tags).toEqual(['base:tool-wrench']);
  });
});
