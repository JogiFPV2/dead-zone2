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
