import type { Color, MeshStandardMaterial } from 'three';
import { Box3, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WeaponModels, placeholderHead, placeholderWeapon } from './weapon-models.js';
import type { WeaponInfo } from './weapon-kinds.js';

const axe: WeaponInfo = {
  id: 'base:fire-axe',
  cls: 'two_handed',
  knockback: 0,
  length: 0.85,
  category: 'blade_long',
};

const luminance = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('weapon placeholders (regression: weapon not visible in the hand)', () => {
  it('weapons without a model get a readable stand-in', () => {
    expect(WeaponModels.hasModel(axe.id)).toBe(false);
    const g = placeholderWeapon(axe);
    const size = new Box3().setFromObject(g).getSize(new Vector3());
    // Not a 2–4 cm stick: the head sticks out sideways and the whole thing is the drawn length.
    expect(size.y).toBeGreaterThan(0.8);
    expect(Math.max(size.x, size.z)).toBeGreaterThanOrEqual(0.12);
    const lum: number[] = [];
    g.traverse((m) => {
      if (m instanceof Mesh) lum.push(luminance((m.material as MeshStandardMaterial).color));
    });
    expect(Math.max(...lum)).toBeGreaterThan(0.5);
  });

  it('picks the head shape from id and category', () => {
    expect(placeholderHead(axe)).toBe('axe');
    expect(placeholderHead({ ...axe, id: 'base:machete' })).toBe('blade');
    expect(placeholderHead({ ...axe, id: 'base:spear', category: 'spear' })).toBe('spear');
    expect(placeholderHead({ ...axe, id: 'base:metal-pipe', category: 'blunt' })).toBe('club');
    expect(placeholderHead({ ...axe, id: 'x', cls: 'firearm' })).toBe('gun');
  });
});
