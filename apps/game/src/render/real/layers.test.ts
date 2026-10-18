import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYER, MAX_LAYERS, layerTables, parseLayers } from './layers.js';

const json: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/layers.json', import.meta.url), 'utf8'),
);

describe('layers.json', () => {
  it('parses Designer’s 13 layers in LAYER order', () => {
    const l = parseLayers(json);
    expect(l.material).toBe('deadzone-pbr');
    expect(l.layers).toHaveLength(13);
    for (const [id, i] of Object.entries(LAYER)) expect(l.layers[i]?.id).toBe(id);
  });

  it('tables: tile metres and mean albedo, padded', () => {
    const { tile, mean } = layerTables(parseLayers(json));
    expect(tile).toHaveLength(MAX_LAYERS);
    expect(tile[LAYER.cegla]).toBe(1.5);
    expect(tile[LAYER.asfalt]).toBe(3);
    expect(mean[LAYER.trawa * 3 + 1]).toBeCloseTo(0.1216, 4);
  });

  it('rejects broken files', () => {
    expect(() => parseLayers({ version: 2, layers: [] })).toThrow();
    expect(() =>
      parseLayers({
        version: 1,
        layers: [{ index: 1, id: 'x', tileMeters: 1, meanLinear: [1, 1, 1] }],
      }),
    ).toThrow(/index/);
  });
});
