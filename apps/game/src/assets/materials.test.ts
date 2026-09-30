import type { LOD } from 'three';
import {
  BoxGeometry,
  BufferGeometry,
  CompressedTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Texture,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { estimateGeometry, estimateObjectGeometry, estimateTexture } from './estimate.js';
import { buildLod } from './lod.js';
import { MaterialRegistry } from './materials.js';

describe('MaterialRegistry', () => {
  it('rebinds meshes by material name and disposes placeholders', () => {
    const reg = new MaterialRegistry();
    const shared = new MeshBasicMaterial();
    reg.register('p/palette', shared);
    const placeholder = new MeshBasicMaterial({ name: 'p/palette' });
    const spy = vi.spyOn(placeholder, 'dispose');
    const other = new MeshBasicMaterial({ name: 'other' });
    const root = new Group().add(
      new Mesh(new BufferGeometry(), placeholder),
      new Mesh(new BufferGeometry(), other),
    );
    expect(reg.bind(root)).toBe(1);
    expect((root.children[0] as Mesh).material).toBe(shared);
    expect((root.children[1] as Mesh).material).toBe(other);
    expect(spy).toHaveBeenCalled();
    expect(() => reg.register('p/palette', new MeshBasicMaterial())).toThrow(/już/);
  });
});

describe('estimate', () => {
  it('counts unique geometry once', () => {
    const g = new BoxGeometry();
    const bytes = estimateGeometry(g);
    // 24 verts × (pos 3 + normal 3 + uv 2) × 4 B + 36 indices × 2 B
    expect(bytes).toBe(24 * 8 * 4 + 36 * 2);
    const root = new Group().add(new Mesh(g), new Mesh(g));
    expect(estimateObjectGeometry(root)).toBe(bytes);
  });

  it('estimates compressed and plain textures', () => {
    const c = new CompressedTexture([{ data: new Uint8Array(1000), width: 8, height: 8 }], 8, 8);
    expect(estimateTexture(c)).toBe(1000);
    const t = new Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
    t.generateMipmaps = false;
    expect(estimateTexture(t)).toBe(64);
  });
});

describe('buildLod', () => {
  it('adds levels with biased thresholds', () => {
    const lod: LOD = buildLod(
      [
        { object: new Group(), distance: 0 },
        { object: new Group(), distance: 30 },
      ],
      100,
    );
    expect(lod.levels.map((l) => l.distance)).toEqual([0, 130]);
  });
});
