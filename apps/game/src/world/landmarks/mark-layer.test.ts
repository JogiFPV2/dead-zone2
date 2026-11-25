import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { MarkLayer, marksGeometry } from './mark-layer.js';

describe('landmark marks', () => {
  it('builds a chimney at its height on its spot (three z = world y)', () => {
    const geo = marksGeometry([{ kind: 'chimney', x: 100, y: 200, r: 5.7, h: 120, seed: 1 }])!;
    const box = new Box3().setFromBufferAttribute(geo.getAttribute('position') as never);
    expect(box.max.y).toBeCloseTo(120, 0);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(100, 1);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(200, 1);
    expect(geo.getAttribute('color')).toBeDefined();
  });

  it('turns the steam engine along rot (long axis = (cos, sin) in world x, y)', () => {
    const along = (rot: number) => {
      const geo = marksGeometry([
        { kind: 'steam-engine', x: 0, y: 0, r: 1.6, h: 4.5, rot, seed: 1 },
      ])!;
      const b = new Box3().setFromBufferAttribute(geo.getAttribute('position') as never);
      return [b.max.x - b.min.x, b.max.z - b.min.z] as const;
    };
    const [x0, z0] = along(0);
    expect(x0).toBeGreaterThan(z0 * 4);
    const [x1, z1] = along(Math.PI / 2);
    expect(z1).toBeGreaterThan(x1 * 4);
  });

  it('every kind builds, and chunks load / unload', () => {
    const layer = new MarkLayer();
    layer.loadChunk(1, 2, [
      { kind: 'water-tower', x: 70, y: 130, r: 4.7, h: 32, seed: 1 },
      { kind: 'silo', x: 80, y: 140, r: 2.5, h: 18, seed: 2 },
      { kind: 'bell-tower', x: 90, y: 150, r: 3.6, h: 11, seed: 3 },
    ]);
    expect(layer.root.children).toHaveLength(1);
    layer.unloadChunk(1, 2);
    expect(layer.root.children).toHaveLength(0);
    layer.loadChunk(0, 0, undefined);
    expect(layer.root.children).toHaveLength(0);
  });
});
