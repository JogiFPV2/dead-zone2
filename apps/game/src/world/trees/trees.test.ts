import { describe, expect, it } from 'vitest';
import { leafClusterPixels } from './leaf-texture.js';
import {
  SPECIES_BY_TYPE,
  TREE_HEIGHT_SCALE,
  TREE_SPECIES,
  heightAt,
  look,
  speciesAt,
} from './species.js';
import {
  CONIFER_CARDS_PER_TIER,
  CONIFER_TIERS,
  CROWN_CARDS,
  coniferGeometry,
  crownGeometry,
  triangles,
  trunkGeometry,
} from './tree-geometry.js';
import { TreeLayer, isTreeProp, speciesOf } from './tree-layer.js';
import { WIND_GLSL } from './wind.js';

describe('real trees: species (content pack)', () => {
  it('reads the town species from @deadzone/content (shrubs and garden-only skipped)', () => {
    expect(SPECIES_BY_TYPE.broadleaf).toEqual([
      'base:birch',
      'base:linden',
      'base:maple',
      'base:oak',
    ]);
    expect(SPECIES_BY_TYPE.conifer).toEqual(['base:pine', 'base:spruce']);
    expect(TREE_SPECIES).not.toContain('base:hazel');
  });
  it('every species of a leaf type shows up, same spot = same tree', () => {
    for (const t of ['broadleaf', 'conifer'] as const) {
      const seen = new Set<string>();
      for (let i = 0; i < 400; i++) seen.add(speciesAt(i * 3.7, i * 1.3, t));
      expect([...seen].sort()).toEqual([...SPECIES_BY_TYPE[t]]);
    }
    expect(speciesAt(10, 20)).toBe(speciesAt(10, 20));
  });
  it('heights within the scaled content range, conifer crowns taller than broadleaf', () => {
    for (const s of TREE_SPECIES) {
      const h = heightAt(s, 5, 7);
      expect(h).toBeGreaterThanOrEqual(look(s).height[0]);
      expect(h).toBeLessThanOrEqual(look(s).height[1]);
    }
    expect(look('base:pine').crownHeight).toBeGreaterThan(look('base:oak').crownHeight);
    expect(look('base:oak').height[0]).toBeCloseTo(15 * TREE_HEIGHT_SCALE);
  });
});

describe('real trees: geometry and leaves', () => {
  it('crown = 2 triangles per leaf card, trunk low-poly', () => {
    expect(triangles(crownGeometry())).toBe(CROWN_CARDS * 2);
    expect(triangles(trunkGeometry())).toBeLessThanOrEqual(48);
    expect(triangles(coniferGeometry())).toBe(CONIFER_TIERS * CONIFER_CARDS_PER_TIER * 2);
  });
  it('leaf texture is a cut-out: both transparent and opaque texels', () => {
    const px = leafClusterPixels(64);
    let on = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) on++;
    const total = px.length / 4;
    expect(on).toBeGreaterThan(total * 0.2);
    expect(on).toBeLessThan(total * 0.9);
  });
  it('wind sway is vertex-only and grows to the crown top', () => {
    expect(WIND_GLSL).toContain('#include <begin_vertex>');
    expect(WIND_GLSL).toContain('wTop');
  });
});

describe('real trees: layer', () => {
  it('takes only kit tree props', () => {
    expect(isTreeProp('prop-tree-tall')).toBe(true);
    expect(isTreeProp('prop-grass-large')).toBe(false);
  });
  it('kit prop picks the leaf type: prop-tree-tall = conifer', () => {
    expect(speciesOf({ x: 3, z: 4, prop: 'prop-tree-tall' })).toMatch(/pine|spruce/);
    expect(speciesOf({ x: 3, z: 4, prop: 'prop-tree' })).not.toMatch(/pine|spruce/);
  });
  it('all trees in 3 instanced meshes (3 draw calls), chunks load / unload', () => {
    const l = new TreeLayer();
    l.load('0,0', [
      { x: 1, z: 2 },
      { x: 5, z: 9, prop: 'prop-tree-tall' },
    ]);
    l.load('1,0', [{ x: 40, z: 2 }]);
    l.update(0);
    expect(l.count).toBe(3);
    expect(l.coniferCount).toBe(1);
    expect(l.root.children).toHaveLength(3);
    l.unload('0,0');
    l.update(0.1);
    expect(l.count).toBe(1);
    expect(l.coniferCount).toBe(0);
    expect(l.root.children).toHaveLength(3);
  });
});
