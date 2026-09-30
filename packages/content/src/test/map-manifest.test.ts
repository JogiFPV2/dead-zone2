import { describe, expect, it } from 'vitest';
import { ItemSchema } from '../schemas/item/item.js';
import { chunkFileName } from '../schemas/map/address.js';
import { MapManifestSchema } from '../schemas/map/manifest.js';
import { manifest } from './map-fixtures.js';

const paths = (r: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.'));

describe('MapManifestSchema', () => {
  it('przyjmuje poprawny manifest', () => {
    expect(MapManifestSchema.parse(manifest()).chunkSize).toBe(32);
  });
  it('chunkSize to literał 32, formatVersion 1, floorHeight > 0, lista niepusta', () => {
    expect(MapManifestSchema.safeParse({ ...manifest(), chunkSize: 16 }).success).toBe(false);
    expect(MapManifestSchema.safeParse({ ...manifest(), formatVersion: 2 }).success).toBe(false);
    expect(MapManifestSchema.safeParse({ ...manifest(), floorHeight: 0 }).success).toBe(false);
    expect(MapManifestSchema.safeParse(manifest([])).success).toBe(false);
  });
  it('odrzuca powtórzony chunk', () => {
    const a = { cx: -1, cy: 2, z: 0 };
    expect(paths(MapManifestSchema.safeParse(manifest([a, a])))).toEqual(['chunks.1']);
    expect(chunkFileName(a)).toBe('-1_2_0.json');
  });
});

describe('placeable: światło i schowek opcjonalne', () => {
  const lamp = { id: 'base:lamp', name: 'item.base.lamp.name', kind: 'placeable', weightKg: 1 };
  it('lampa z blokiem light dostaje domyślne wartości', () => {
    const r = ItemSchema.parse({ ...lamp, placeable: { light: { radiusTiles: 5 } } });
    expect(r.kind === 'placeable' && r.placeable.light).toEqual({
      radiusTiles: 5,
      intensity: 1,
      color: '#ffffff',
      requiresPower: true,
    });
  });
  it('odrzuca zły kolor', () => {
    const bad = { ...lamp, placeable: { light: { radiusTiles: 5, color: 'yellow' } } };
    expect(ItemSchema.safeParse(bad).success).toBe(false);
  });
});
