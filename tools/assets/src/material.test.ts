import { describe, expect, it } from 'vitest';
import { MaterialFieldsSchema, materialOf } from './material.js';
import { modelRef, parsePack } from './pack.js';

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

  it('pbr needs the atlas; normal and roughness are optional', () => {
    const pbr = { atlas: 'textures/blok-p4/atlas.ktx2', normal: 'textures/blok-p4/normal.ktx2' };
    expect(MaterialFieldsSchema.parse({ material: 'pbr', pbr })).toEqual({ material: 'pbr', pbr });
    expect(materialOf({ material: 'pbr', pbr })).toEqual({ material: 'pbr', pbr });
    expect(MaterialFieldsSchema.safeParse({ material: 'pbr' }).success).toBe(false);
    expect(MaterialFieldsSchema.safeParse({ material: 'pbr', pbr: {} }).success).toBe(false);
    expect(MaterialFieldsSchema.safeParse({ pbr }).success).toBe(false);
    expect(MaterialFieldsSchema.safeParse({ material: 'vc', pbr }).success).toBe(false);
    expect(MaterialFieldsSchema.safeParse({ material: 'metal' }).success).toBe(false);
  });

  it('texture paths: relative to public, no .., known formats', () => {
    const ok = (atlas: string) =>
      MaterialFieldsSchema.safeParse({ material: 'pbr', pbr: { atlas } }).success;
    expect(ok('textures/a.ktx2')).toBe(true);
    expect(ok('models/deadzone-town/atlas.webp')).toBe(true);
    expect(ok('/textures/a.ktx2')).toBe(false);
    expect(ok('https://cdn/a.png')).toBe(false);
    expect(ok('textures/../secret.png')).toBe(false);
    expect(ok('textures/a.glb')).toBe(false);
  });

  it('pack models carry it (file defaults to id) and refuse a pbr model without maps', () => {
    const pbr = { atlas: 'textures/car/atlas.ktx2' };
    const p = parsePack(pack([{ id: 'car', material: 'pbr', pbr }]));
    expect(modelRef(p.models[0]!)).toEqual({ id: 'car', file: 'car', material: 'pbr', pbr });
    expect(() => parsePack(pack([{ id: 'car', material: 'pbr' }]))).toThrow(/car: material: pbr/);
  });
});
