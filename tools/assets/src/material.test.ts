import { describe, expect, it } from 'vitest';
import { MaterialFieldsSchema, PbrLayersFileSchema, materialOf, pbrFiles } from './material.js';
import { ModelScale, modelRef, parsePack, scaleOf } from './pack.js';

const pack = (models: unknown[]) => ({
  id: 't',
  name: 'T',
  author: 'Deadzone',
  licence: 'CC0-1.0',
  licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  source: 'https://example.com/',
  files: [{ path: 'furniture/a.glb', sha256: 'a'.repeat(64), name: 'a.glb' }],
  root: 'glb',
  models,
});

describe('material: vc | pbr', () => {
  it('defaults to vc, old entries unchanged', () => {
    expect(MaterialFieldsSchema.parse({})).toEqual({});
    expect(materialOf({})).toEqual({ material: 'vc' });
    const p = parsePack(pack(['a', { id: 'b', file: 'B' }]));
    expect(p.models.map(modelRef)).toEqual([
      { id: 'a', file: 'a' },
      { id: 'b', file: 'B' },
    ]);
  });

  const T = 'textures/pbr/deadzone-pbr';
  const full = {
    albedo: `${T}-albedo-1024.ktx2`,
    normal: `${T}-normal-1024.ktx2`,
    orm: `${T}-orm-1024.ktx2`,
    layers: 'textures/pbr/layers.json',
  };
  const lowRes = {
    albedo: `${T}-albedo-512.ktx2`,
    normal: `${T}-normal-512.ktx2`,
    orm: `${T}-orm-512.ktx2`,
  };

  it('pbr needs albedo, normal, orm and layers; lowRes is optional but complete', () => {
    for (const pbr of [full, { ...full, lowRes }]) {
      expect(MaterialFieldsSchema.parse({ material: 'pbr', pbr })).toEqual({
        material: 'pbr',
        pbr,
      });
      expect(materialOf({ material: 'pbr', pbr })).toEqual({ material: 'pbr', pbr });
    }
    const bad = (pbr: unknown) => MaterialFieldsSchema.safeParse({ material: 'pbr', pbr }).success;
    expect(MaterialFieldsSchema.safeParse({ material: 'pbr' }).success).toBe(false);
    expect(bad({})).toBe(false);
    for (const k of ['albedo', 'normal', 'orm', 'layers'] as const) {
      const rest: Record<string, string> = { ...full };
      delete rest[k];
      expect(bad(rest)).toBe(false);
    }
    expect(bad({ ...full, lowRes: { albedo: lowRes.albedo } })).toBe(false);
    // old #227 fields are gone; the layer number lives in the GLB (TEXCOORD_1)
    expect(bad({ ...full, atlas: full.albedo })).toBe(false);
    expect(bad({ ...full, roughness: full.orm })).toBe(false);
    expect(bad({ ...full, layer: 3 })).toBe(false);
    expect(MaterialFieldsSchema.safeParse({ pbr: full }).success).toBe(false);
    expect(MaterialFieldsSchema.safeParse({ material: 'vc', pbr: full }).success).toBe(false);
    expect(MaterialFieldsSchema.safeParse({ material: 'metal' }).success).toBe(false);
    expect(pbrFiles({ ...full, lowRes })).toHaveLength(7);
  });

  it('paths: relative to public, no .., textures .ktx2/.png/.webp, layers .json', () => {
    const ok = (over: object) =>
      MaterialFieldsSchema.safeParse({ material: 'pbr', pbr: { ...full, ...over } }).success;
    expect(ok({ albedo: 'textures/a.png', normal: 'models/n.webp' })).toBe(true);
    expect(ok({ albedo: '/textures/a.ktx2' })).toBe(false);
    expect(ok({ albedo: 'https://cdn/a.png' })).toBe(false);
    expect(ok({ orm: 'textures/../secret.png' })).toBe(false);
    expect(ok({ albedo: 'textures/a.glb' })).toBe(false);
    expect(ok({ albedo: 'textures/a.json' })).toBe(false);
    expect(ok({ layers: 'textures/pbr/layers.ktx2' })).toBe(false);
    expect(ok({ layers: '../layers.json' })).toBe(false);
  });

  it('layers.json: index = position, unique ids, Designer fields', () => {
    const layer = (index: number, id: string) => ({
      index,
      id,
      name: id,
      source: 'ambientCG Asphalt031 (CC0 1.0)',
      url: index ? null : 'https://ambientcg.com/view?id=Asphalt031',
      tileMeters: 3,
      tint: index ? 'tint' : 'natural',
      meanLinear: [0.1375, 0.1375, 0.1374],
      meanRoughness: 0.881,
    });
    const file = (layers: unknown[]) => ({ version: 1, material: 'deadzone-pbr', layers });
    expect(
      PbrLayersFileSchema.safeParse(file([layer(0, 'asfalt'), layer(1, 'plyty')])).success,
    ).toBe(true);
    expect(PbrLayersFileSchema.safeParse(file([layer(1, 'asfalt')])).success).toBe(false);
    expect(PbrLayersFileSchema.safeParse(file([layer(0, 'a'), layer(1, 'a')])).success).toBe(false);
    expect(PbrLayersFileSchema.safeParse(file([])).success).toBe(false);
    expect(PbrLayersFileSchema.safeParse(file([{ ...layer(0, 'a'), tint: 'red' }])).success).toBe(
      false,
    );
    expect(PbrLayersFileSchema.safeParse({ ...file([layer(0, 'a')]), version: 2 }).success).toBe(
      false,
    );
  });

  it('pack models carry it (file defaults to id) and refuse a pbr model without maps', () => {
    const pbr = full;
    const p = parsePack(pack([{ id: 'car', material: 'pbr', pbr }]));
    expect(modelRef(p.models[0]!)).toEqual({ id: 'car', file: 'car', material: 'pbr', pbr });
    expect(() => parsePack(pack([{ id: 'car', material: 'pbr' }]))).toThrow(/car: material: pbr/);
  });
});

describe('model scale', () => {
  it('optional, positive and finite, default 1 (sedan 1.69), with vc or pbr', () => {
    const p = parsePack(
      pack([
        'a',
        { id: 'sedan', scale: 1.69 },
        {
          id: 'car',
          material: 'pbr',
          pbr: { albedo: 'a.ktx2', normal: 'n.ktx2', orm: 'o.ktx2', layers: 'l.json' },
          scale: 2,
        },
      ]),
    );
    expect(p.models.map((m) => scaleOf(modelRef(m)))).toEqual([1, 1.69, 2]);
    expect(modelRef(p.models[1]!)).toEqual({ id: 'sedan', file: 'sedan', scale: 1.69 });
    for (const bad of [0, -1, Infinity, NaN, '1.69']) {
      expect(ModelScale.safeParse(bad).success).toBe(false);
      expect(() => parsePack(pack([{ id: 'sedan', scale: bad }]))).toThrow();
    }
  });
});
