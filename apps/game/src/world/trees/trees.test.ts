import { describe, expect, it } from 'vitest';
import { leafClusterPixels } from './leaf-texture.js';
import { SPECIES_LOOK, TREE_SPECIES, heightAt, speciesAt } from './species.js';
import { CROWN_CARDS, crownGeometry, triangles, trunkGeometry } from './tree-geometry.js';
import { TreeLayer, isTreeProp } from './tree-layer.js';
import { WIND_GLSL } from './wind.js';

describe('real trees: species', () => {
  it('shares sum to 1 and every deciduous species shows up', () => {
    const sum = TREE_SPECIES.reduce((a, s) => a + SPECIES_LOOK[s].share, 0);
    expect(sum).toBeCloseTo(1);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(speciesAt(i * 3.7, i * 1.3));
    expect([...seen].sort()).toEqual([...TREE_SPECIES].sort());
  });
  it('same spot = same tree, heights within the species range', () => {
    expect(speciesAt(10, 20)).toBe(speciesAt(10, 20));
    for (const s of TREE_SPECIES) {
      const h = heightAt(s, 5, 7);
      expect(h).toBeGreaterThanOrEqual(SPECIES_LOOK[s].height[0]);
      expect(h).toBeLessThanOrEqual(SPECIES_LOOK[s].height[1]);
    }
  });
});

describe('real trees: geometry and leaves', () => {
  it('crown = 2 triangles per leaf card, trunk low-poly', () => {
    expect(triangles(crownGeometry())).toBe(CROWN_CARDS * 2);
    expect(triangles(trunkGeometry())).toBeLessThanOrEqual(48);
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
  it('all trees in 2 instanced meshes (2 draw calls), chunks load / unload', () => {
    const l = new TreeLayer();
    l.load('0,0', [
      { x: 1, z: 2 },
      { x: 5, z: 9 },
    ]);
    l.load('1,0', [{ x: 40, z: 2 }]);
    l.update(0);
    expect(l.count).toBe(3);
    expect(l.root.children).toHaveLength(2);
    l.unload('0,0');
    l.update(0.1);
    expect(l.count).toBe(1);
    expect(l.root.children).toHaveLength(2);
  });
});
