import { describe, expect, it } from 'vitest';
import {
  categoryCounts,
  categoryOfKind,
  characterSlots,
  filterRows,
  INV2_CATEGORIES,
  tapMoveFrom,
} from './inv2-model.js';
import type { InvRowVM } from './inv3-model.js';

const row = (def: string, count = 1) => ({ key: def, def, count }) as unknown as InvRowVM;
const kinds: Record<string, string> = {
  'base:axe': 'weapon_melee',
  'base:canned-beans': 'food',
  'base:bandage': 'medical',
  'base:battery': 'misc',
};
const kindOf = (d: string) => kinds[d];

describe('inventory v2 categories', () => {
  it('rail order from the spec', () => {
    expect(INV2_CATEGORIES.map((c) => c.label)).toEqual([
      'Wszystko',
      'Broń',
      'Jedzenie',
      'Medyczne',
      'Narzędzia',
      'Ubrania',
      'Inne',
    ]);
  });
  it('maps kinds, unknown → Inne', () => {
    expect(categoryOfKind('drink')).toBe('food');
    expect(categoryOfKind('ammo')).toBe('weapon');
    expect(categoryOfKind('container')).toBe('clothing');
    expect(categoryOfKind(undefined)).toBe('other');
  });
  it('counts stacks per category', () => {
    const c = categoryCounts(
      [row('base:axe'), row('base:bandage', 3), row('base:battery', 4)],
      kindOf,
    );
    expect(c).toMatchObject({ all: 8, weapon: 1, medical: 3, other: 4, food: 0 });
  });
  it('filters rows', () => {
    const rows = [row('base:axe'), row('base:canned-beans', 2)];
    expect(filterRows(rows, 'food', kindOf).map((r) => r.def)).toEqual(['base:canned-beans']);
    expect(filterRows(rows, 'all', kindOf)).toHaveLength(2);
  });
});

describe('inventory v2 character strip', () => {
  it('six slots in spec order; two-handed fills both hands; torso outer before inner', () => {
    const s = characterSlots({
      hand_primary: 7,
      hand_secondary: 7,
      torso_inner: 3,
      torso_outer: 4,
    });
    expect(s.map((x) => x.key)).toEqual(['P', 'L', 'back', 'torso', 'legs', 'hands']);
    expect(s.map((x) => x.itemId)).toEqual([7, 7, undefined, 4, undefined, undefined]);
  });
});

describe('inventory v2 tap to move', () => {
  it('moves from the other side only when it has a selection', () => {
    expect(tapMoveFrom('box', { own: 2, box: 0 })).toBe('own');
    expect(tapMoveFrom('own', { own: 2, box: 0 })).toBeUndefined();
    expect(tapMoveFrom('own', { own: 0, box: 1 })).toBe('box');
  });
});
