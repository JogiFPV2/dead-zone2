import { describe, expect, it } from 'vitest';
import { usesPbr } from './loader.js';
import { parseManifest, parsePbrFields, pbrModelFile, pbrVariantFile } from './manifest.js';

const maps = {
  albedo: 'textures/pbr/deadzone-pbr-albedo-1024.ktx2',
  normal: 'textures/pbr/deadzone-pbr-normal-1024.ktx2',
  orm: 'textures/pbr/deadzone-pbr-orm-1024.ktx2',
  layers: 'textures/pbr/layers.json',
  lowRes: {
    albedo: 'textures/pbr/deadzone-pbr-albedo-512.ktx2',
    normal: 'textures/pbr/deadzone-pbr-normal-512.ktx2',
    orm: 'textures/pbr/deadzone-pbr-orm-512.ktx2',
  },
};

describe('manifest: material / pbr / scale (Modules schema)', () => {
  it('reads material pbr with the three arrays, layers, lowRes and scale', () => {
    expect(parsePbrFields({ material: 'pbr', pbr: maps, scale: 1.69 })).toEqual({
      material: 'pbr',
      pbr: maps,
      scale: 1.69,
    });
  });

  it('absent or old shape: stays vc / no maps, never throws', () => {
    expect(parsePbrFields({})).toEqual({});
    expect(parsePbrFields({ material: 'vc' })).toEqual({});
    expect(parsePbrFields({ material: 'pbr', pbr: { atlas: 'textures/a.ktx2' } })).toEqual({
      material: 'pbr',
    });
    expect(
      parsePbrFields({ material: 'pbr', pbr: { ...maps, albedo: '../x.ktx2' } }).pbr,
    ).toBeUndefined();
    expect(parsePbrFields({ scale: -1 })).toEqual({});
  });

  it('parseManifest keeps the fields on the asset', () => {
    const m = parseManifest({
      version: 1,
      packs: [
        { id: 'p', name: 'n', author: 'a', licence: 'CC0-1.0', licenceUrl: 'u', source: 's' },
      ],
      assets: [
        {
          id: 'p/sedan',
          pack: 'p',
          sourceBytes: 1,
          lods: [{ file: 'p/sedan.glb', distance: 0, bytes: 1, triangles: 1 }],
          material: 'pbr',
          pbr: maps,
          scale: 1.69,
        },
      ],
    });
    expect(m.assets[0]).toMatchObject({ material: 'pbr', scale: 1.69, pbr: maps });
  });

  it('PBR path only with the style hook and material pbr; variant file next to the model', () => {
    const hook = { material: {} as never, prepare: (g: never) => g };
    expect(usesPbr({ material: 'pbr' }, hook)).toBe(true);
    expect(usesPbr({}, hook)).toBe(false);
    expect(usesPbr({ material: 'pbr' }, undefined)).toBe(false);
    expect(usesPbr({ material: 'pbr' })).toBe(false); // default: no hook set
    expect(pbrVariantFile('kenney-car-kit/sedan.glb')).toBe('kenney-car-kit/sedan.pbr.glb');
  });
});

describe('pbrModelFile', () => {
  it('a built PBR asset (pbr data) is its own model; otherwise the *.pbr.glb variant', () => {
    const pbr = { albedo: 'a.ktx2', normal: 'n.ktx2', orm: 'o.ktx2', layers: 'l.json' };
    expect(pbrModelFile({ pbr }, 'deadzone-pbr/sedan.glb')).toBe('deadzone-pbr/sedan.glb');
    expect(pbrModelFile({}, 'kenney-car-kit/sedan.glb')).toBe('kenney-car-kit/sedan.pbr.glb');
  });
});
