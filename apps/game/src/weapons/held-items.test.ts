import { Group, Matrix4, Mesh, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import {
  HeldItemPool,
  POOL_CATEGORIES,
  devHeld,
  heldCategoryOf,
  heldGeometry,
  heldHands,
  triangles,
} from './held-items.js';

describe('heldCategoryOf', () => {
  it('weapons by grip, the rest by tag / kind', () => {
    expect(heldCategoryOf({ id: 'base:pistol', kind: 'weapon_ranged' })).toBe('pistol');
    expect(
      heldCategoryOf({ id: 'base:crowbar', kind: 'weapon_melee', melee: { category: 'blunt' } }),
    ).toBe('twoHanded');
    expect(heldCategoryOf({ id: 'base:flashlight', kind: 'tool', tags: ['base:flashlight'] })).toBe(
      'flashlight',
    );
    expect(heldCategoryOf({ id: 'base:canned-beans', kind: 'food' })).toBe('food');
    expect(heldCategoryOf({ id: 'base:water-bottle', kind: 'drink' })).toBe('food');
    expect(heldCategoryOf({ id: 'base:saw', kind: 'tool' })).toBe('tool');
    expect(heldCategoryOf({ id: 'base:plank', kind: 'material' })).toBe('plank');
    expect(
      heldCategoryOf({ id: 'base:tote-bag', kind: 'container', tags: ['base:bag-hand'] }),
    ).toBe('bag');
    expect(heldCategoryOf({ id: 'base:hoodie', kind: 'clothing' })).toBeUndefined();
  });
});

describe('heldHands (§3 hand rule)', () => {
  it('two-handed takes both hands; a lone flashlight goes right', () => {
    expect(heldHands('rifle', 'flashlight')).toEqual({ R: 'rifle' });
    expect(heldHands('plank', 'food')).toEqual({ R: 'plank' });
    expect(heldHands(undefined, 'flashlight')).toEqual({ R: 'flashlight' });
    expect(heldHands('pistol', 'flashlight')).toEqual({ R: 'pistol', L: 'flashlight' });
    expect(heldHands(undefined, 'food')).toEqual({ L: 'food' });
  });

  it('dev ?held=R,L by id or category', () => {
    const idx = new Map([['base:canned-beans', 'food' as const]]);
    expect(devHeld(',flashlight', idx)).toEqual({ secondary: 'flashlight' });
    expect(devHeld('melee1,base:canned-beans', idx)).toEqual({
      primary: 'melee1',
      secondary: 'food',
    });
    expect(devHeld(null, idx)).toBeUndefined();
  });
});

describe('HeldItemPool (§5 budget)', () => {
  it('low-poly shapes (flashlight / can ≤ 24 tris, rest ≤ 60)', () => {
    for (const c of POOL_CATEGORIES) {
      const t = triangles(heldGeometry(c));
      expect(t).toBeLessThanOrEqual(c === 'flashlight' || c === 'food' ? 24 : 60);
    }
  });

  it('one shared material; at most one draw call per shape in use (≤ +3 for a scene)', () => {
    const scene = new Scene();
    const pool = new HeldItemPool(scene);
    const mats = new Set<unknown>();
    scene.traverse((o) => o instanceof Mesh && mats.add(o.material));
    expect(mats.size).toBe(1);
    expect(pool.drawCalls).toBe(0);
    const m = new Matrix4();
    // 32 characters with a flashlight + one with a can: two calls.
    const items = [
      ...Array.from({ length: 32 }, () => ({ category: 'flashlight' as const, matrix: m })),
      { category: 'food' as const, matrix: m },
    ];
    pool.update(items);
    expect(pool.drawCalls).toBe(2);
    expect(pool.meshes.get('flashlight')!.count).toBe(32);
    pool.update([{ category: 'bag', matrix: m }]);
    expect(pool.drawCalls).toBe(1);
    pool.update([]);
    expect(pool.drawCalls).toBe(0);
    expect(new Group().children.length).toBe(0);
  });
});
