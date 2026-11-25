import type { ContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../../state/game-state.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex, type HudItemDef } from '../content-index.js';
import { dollDropSlot, dollVM, pct } from './paperdoll-model.js';

const cloth = (id: string, slot: string, ins: number, sc = 0, water = 0): HudItemDef =>
  ({
    id,
    kind: 'clothing',
    maxStack: 1,
    weightKg: 0.5,
    equipSlots: [slot, 'hand_primary', 'hand_secondary'],
    clothing: { insulation: ins, waterResistance: water, scratch: sc, bite: sc / 4 },
  }) as HudItemDef;
const defs: HudItemDef[] = [
  cloth('base:jacket', 'torso_outer', 0.5, 0.2, 0.3),
  cloth('base:t-shirt', 'torso_inner', 0.1, 0.05),
  cloth('base:jeans', 'legs', 0.25, 0.15),
  cloth('base:boots', 'feet', 0.2, 0.3, 0.4),
  {
    id: 'base:hiking-bag',
    kind: 'container',
    maxStack: 1,
    weightKg: 1,
    equipSlots: ['back'],
  },
  {
    id: 'base:crowbar',
    kind: 'weapon_melee',
    maxStack: 1,
    weightKg: 1.6,
    equipSlots: ['hand_primary', 'hand_secondary'],
  },
];
const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  items: new Map(defs.map((d) => [d.id, d])),
};
const main: ContainerView = {
  id: 1,
  kind: 'inventory',
  capacityKg: null,
  weightKg: 3,
  items: [
    { id: 10, def: 'base:jacket', count: 1, weightKg: 1, equipped: ['torso_outer'] },
    { id: 11, def: 'base:t-shirt', count: 1, weightKg: 0.2, equipped: ['torso_inner'] },
    { id: 12, def: 'base:jeans', count: 1, weightKg: 0.8, equipped: ['legs'] },
    { id: 13, def: 'base:boots', count: 1, weightKg: 1 },
    { id: 14, def: 'base:crowbar', count: 1, weightKg: 1.6, equipped: ['hand_secondary'] },
  ],
};
const s: GameState = {
  ...INITIAL_GAME_STATE,
  inventory: {
    container: 1,
    loadKg: 3,
    capacityKg: 12,
    hardLimitKg: 24,
    carryLoad: 25,
    equipped: { torso_outer: 10, torso_inner: 11, legs: 12, hand_secondary: 14 },
    containers: { 1: main },
  },
};

describe('character drawing (inventory)', () => {
  it('shows what is worn in each place, empty places by label', () => {
    const vm = dollVM(s, content);
    const at = (slot: string) => vm.slots.find((x) => x.slot === slot);
    expect(at('torso_outer')?.item?.def).toBe('base:jacket');
    expect(at('legs')?.item?.def).toBe('base:jeans');
    expect(at('hand_secondary')?.item?.def).toBe('base:crowbar');
    expect(at('feet')?.item).toBeUndefined();
    expect(at('feet')?.label).toBe('Buty');
  });

  it('totals: warmth sums, water is the best, protection is the mean of body parts', () => {
    const t = dollVM(s, content).totals;
    expect(t.warmth).toBeCloseTo(0.85);
    expect(t.water).toBeCloseTo(0.3);
    // head 0, torso max(0.2, 0.05), hands 0, legs 0.15, feet 0 → 0.35 / 5.
    expect(t.scratch).toBeCloseTo(0.07);
    expect(pct(0.355)).toBe('36%');
  });

  it('dropping on the drawing: the place under the pointer if it fits, else the own place', () => {
    expect(dollDropSlot(content, 'base:boots', 'head')).toBe('feet');
    expect(dollDropSlot(content, 'base:boots', undefined)).toBe('feet');
    expect(dollDropSlot(content, 'base:boots', 'hand_secondary')).toBe('hand_secondary');
    expect(dollDropSlot(content, 'base:hiking-bag', 'legs')).toBe('back');
    // A bag is not held by a drop on a hand it cannot take.
    expect(dollDropSlot(content, 'base:hiking-bag', 'hand_primary')).toBeUndefined();
    expect(dollDropSlot(content, 'base:apple', undefined)).toBeUndefined();
  });
});
