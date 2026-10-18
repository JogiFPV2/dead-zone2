import { BoxGeometry, BufferAttribute, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { townCells, type TownKit } from '../../world/town/kit.js';
import { parseLayers } from './layers.js';
import { createPbrUniforms, preparePbrGeometry } from './pbr-material.js';
import { REAL_QUALITY } from './quality.js';
import { realTownKit } from './real-kit.js';

const index = {
  wall: { uv: [0.03, 0.03] as [number, number], hex: '#aaaaaa' },
  'grass-b': { uv: [0.09, 0.03] as [number, number], hex: '#557733' },
  'trim-wood': { uv: [0.16, 0.03] as [number, number], hex: '#665544' },
  paint: { uv: [0.22, 0.03] as [number, number], hex: '#cccccc' },
};

function kitGeo(): BoxGeometry {
  const g = new BoxGeometry(1, 3, 0.2);
  g.deleteAttribute('uv');
  g.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2),
  );
  return g;
}

function fakeKit(): TownKit {
  const material = new MeshStandardMaterial({ map: new Texture() });
  material.name = 'deadzone-town/palette';
  return {
    geometries: new Map([
      ['wall-plaster', kitGeo()],
      ['prop-tree', new BoxGeometry(1, 5, 1)],
    ]),
    material,
    cells: townCells({ cells: index }),
    detail: new Texture(),
    cellIndex: index,
  };
}

const layers = parseLayers({
  version: 1,
  layers: Array.from({ length: 13 }, (_, i) => ({
    index: i,
    id: `l${i}`,
    tileMeters: 2,
    meanLinear: [0.5, 0.5, 0.5],
  })),
});
const tx = { alb: new Texture(), nrm: new Texture(), orm: new Texture() };

describe('realTownKit', () => {
  it('swaps materials and trees, keeps the input kit and the kit attribute set', () => {
    const kit = fakeKit();
    const before = new Map(kit.geometries);
    const tree = preparePbrGeometry(new BoxGeometry(2, 9, 2));
    const real = realTownKit(
      kit,
      createPbrUniforms(tx, layers, REAL_QUALITY.low),
      new Map([['drzewo-lisciaste', tree]]),
    );
    // Input untouched (default look keeps working from the same kit object).
    expect(kit.geometries).toEqual(before);
    expect(kit.material.name).toBe('deadzone-town/palette');
    expect(kit.terrainMaterial).toBeUndefined();
    // Real kit: own material + terrain material, wall geometry shared, tree replaced.
    expect(real.material).not.toBe(kit.material);
    expect(real.material.name).toBe('deadzone-pbr/kit');
    expect(real.material.map).toBe(kit.material.map);
    expect(real.terrainMaterial?.name).toBe('deadzone-pbr/terrain');
    expect(real.geometries.get('wall-plaster')).toBe(kit.geometries.get('wall-plaster'));
    const t = real.geometries.get('prop-tree')!;
    expect(t).not.toBe(kit.geometries.get('prop-tree'));
    expect(Object.keys(t.attributes).sort()).toEqual(
      Object.keys(kit.geometries.get('wall-plaster')!.attributes).sort(),
    );
    t.computeBoundingBox();
    expect(t.boundingBox!.max.y - t.boundingBox!.min.y).toBeCloseTo(5, 5);
  });

  it('missing models: kit geometry unchanged (fallback to the current model)', () => {
    const kit = fakeKit();
    const real = realTownKit(kit, createPbrUniforms(tx, layers, REAL_QUALITY.low), new Map());
    expect(real.geometries.get('prop-tree')).toBe(kit.geometries.get('prop-tree'));
  });
});
