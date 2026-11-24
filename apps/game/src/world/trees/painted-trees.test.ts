import { describe, expect, it } from 'vitest';
import { PAINTED_PLANTS, plantModel, SPECIES_PLANT } from './painted-plants.js';
import { plantOf, SCRUB_PROP, scrubSpots, SHRUB_SHARE } from './painted-tree-layer.js';
import { TREE_SPECIES } from './species.js';

describe('painted plant models', () => {
  it('every model has bark and shaded leaves, normalised to height 1 at the origin', () => {
    for (const id of PAINTED_PLANTS) {
      const m = plantModel(id);
      for (const g of [m.bark, m.leaves]) {
        expect(g.getAttribute('position').count).toBeGreaterThan(0);
        expect(g.getAttribute('normal')).toBeDefined();
        expect(g.getAttribute('uv')).toBeDefined();
      }
      expect(m.leaves.getAttribute('color')).toBeDefined();
      const top = Math.max(m.bark.boundingBox!.max.y, m.leaves.boundingBox!.max.y);
      expect(top).toBeCloseTo(1, 5);
      expect(m.bark.boundingBox!.min.y).toBeGreaterThan(-0.05);
    }
  });

  it('stays light enough to instance a wood (triangles per tree)', () => {
    for (const id of PAINTED_PLANTS) {
      const m = plantModel(id);
      const tris =
        (m.bark.getAttribute('position').count + m.leaves.getAttribute('position').count) / 3;
      expect(tris, id).toBeLessThan(2500);
    }
  });
});

describe('painted planting', () => {
  it('every town species has a model', () => {
    for (const s of TREE_SPECIES) expect(SPECIES_PLANT[s.replace(/^base:/, '')], s).toBeDefined();
  });

  it('woods species keep their kind: pines, spruces, birches', () => {
    expect(plantOf({ x: 3, z: 4, species: 'base:pine' })?.plant).toBe('sosna');
    expect(plantOf({ x: 3, z: 4, species: 'base:spruce' })?.plant).toBe('swierk');
    expect(plantOf({ x: 3, z: 4, species: 'base:birch' })?.plant).toBe('brzoza');
    expect(plantOf({ x: 3, z: 4, species: 'base:hazel' })?.plant).toBe('krzew');
    const apple = plantOf({ x: 3, z: 4, species: 'base:apple' })!;
    expect(apple.plant).toBe('jablon');
    expect(apple.height).toBeGreaterThan(2);
    expect(apple.height).toBeLessThan(4.1);
  });

  it('only a share of the grass tufts become shrubs', () => {
    let shrubs = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const p = plantOf({
        x: (i % 50) + 0.5,
        z: Math.floor(i / 50) + 0.5,
        prop: 'prop-grass-large',
      });
      if (p) {
        shrubs++;
        expect(p.plant).toBe('krzew');
        expect(p.height).toBeLessThan(1.2);
      }
    }
    expect(shrubs / n).toBeGreaterThan(SHRUB_SHARE - 0.06);
    expect(shrubs / n).toBeLessThan(SHRUB_SHARE + 0.06);
  });

  it('a hedge strip gets a dense row of shrubs, a scrub zone loose ones', () => {
    const hedge = scrubSpots([{ x: 10, y: 20, w: 12, h: 1 }]);
    expect(hedge.length).toBe(15);
    for (const s of hedge) {
      expect(s.prop).toBe(SCRUB_PROP);
      expect(s.z).toBe(20.5);
    }
    const scrub = scrubSpots([{ x: 0, y: 0, w: 10, h: 10 }]);
    expect(scrub.length).toBeGreaterThan(10);
    expect(scrub.length).toBeLessThan(45);
  });
});
