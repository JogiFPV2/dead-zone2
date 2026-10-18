import { BoxGeometry, BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { bakePbrScene, pbrVariantFile, pbrModelSources, toKitGeometry } from './models.js';
import { preparePbrGeometry } from './pbr-material.js';

/** A Designer-like geometry: uv (metres / tile) + uv1 (layer, grime) + colour. */
function designerGeometry(): BoxGeometry {
  const g = new BoxGeometry(2, 4, 2);
  const n = g.getAttribute('position').count;
  const l = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) l[i * 2] = i < n / 2 ? 3 : 10;
  g.setAttribute('uv1', new BufferAttribute(l, 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

describe('deadzone-pbr models', () => {
  it('pbrVariantFile', () => {
    expect(pbrVariantFile('buildings/blok-p4.glb')).toBe('buildings/blok-p4.pbr.glb');
    expect(pbrVariantFile('a.pbr.glb')).toBe('a.pbr.glb');
  });

  it('preparePbrGeometry renames uv / uv1 to pbrUv / pbrL', () => {
    const g = preparePbrGeometry(designerGeometry());
    expect(g.getAttribute('uv')).toBeUndefined();
    expect(g.getAttribute('uv1')).toBeUndefined();
    expect(g.getAttribute('pbrUv').itemSize).toBe(2);
    expect(g.getAttribute('pbrL').getX(0)).toBe(3);
    expect(preparePbrGeometry(g)).toBe(g);
  });

  it('bakePbrScene scales the single mesh', () => {
    const s = new Group();
    s.add(new Mesh(designerGeometry(), new MeshBasicMaterial()));
    const g = bakePbrScene(s, 1.69);
    expect(g.boundingBox!.max.y).toBeCloseTo(2 * 1.69, 5);
    expect(g.getAttribute('pbrL')).toBeDefined();
  });

  it('toKitGeometry: kit attribute set, cell uv per layer, fitted height, base at 0', () => {
    const src = preparePbrGeometry(designerGeometry());
    const g = toKitGeometry(src, (l) => (l === 3 ? [0.1, 0.2] : [0.7, 0.8]), 6);
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect(g.index).not.toBeNull();
    expect([g.getAttribute('uv').getX(0), g.getAttribute('uv').getY(0)]).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
    ]);
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(g.boundingBox!.max.y).toBeCloseTo(6, 6);
  });
});

describe('pbrModelSources', () => {
  const lod = (file: string) => [{ file, distance: 0, triangles: 1, bytes: 1 }];

  it('built manifest PBR assets only; asset scale on top, sedan fallback 1.69, else 1', () => {
    const sources = pbrModelSources([
      { material: 'pbr', lods: lod('deadzone-pbr/sedan.glb') },
      { material: 'pbr', lods: lod('deadzone-pbr/krzak.glb'), scale: 2 },
      { material: 'pbr', lods: lod('deadzone-pbr/blok-p4.glb') },
      { lods: lod('kenney/tree.glb') },
      { material: 'pbr', lods: [] },
    ]);
    expect(sources).toEqual([
      { id: 'sedan', url: 'models/deadzone-pbr/sedan.glb', scale: 1.69 },
      { id: 'krzak', url: 'models/deadzone-pbr/krzak.glb', scale: 2 },
      { id: 'blok-p4', url: 'models/deadzone-pbr/blok-p4.glb', scale: 1 },
    ]);
    expect(
      pbrModelSources([{ material: 'pbr', lods: lod('m/sedan.glb'), scale: 1.5 }])[0]?.scale,
    ).toBe(1.5);
  });
});

describe('bakePbrScene on meshopt-quantized models', () => {
  it('keeps the node dequantize scale (no clamp to [-1, 1]) and the asset scale on top', () => {
    const g = preparePbrGeometry(designerGeometry());
    const p = g.getAttribute('position');
    const q = new Int16Array(p.count * 3);
    for (let i = 0; i < p.count * 3; i++) q[i] = Math.round(((p.array[i] ?? 0) / 4) * 32767);
    g.setAttribute('position', new BufferAttribute(q, 3, true));
    const mesh = new Mesh(g, new MeshBasicMaterial());
    mesh.scale.setScalar(4); // dequantize transform as written by gltf-transform
    const root = new Group().add(mesh);
    const baked = bakePbrScene(root, 1.69);
    const size = baked.boundingBox!.max.x - baked.boundingBox!.min.x;
    expect(size).toBeCloseTo(2 * 1.69, 2);
    expect(baked.getAttribute('position').array).toBeInstanceOf(Float32Array);
  });
});
