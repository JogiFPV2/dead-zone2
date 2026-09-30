import { describe, expect, it } from 'vitest';
import { BASE_PACK_DIR, validatePackDirs } from '@deadzone/content/node';
import { mapDataToChunkSource } from '../world/content-map.js';
import { minimapGeometry, isRoadTile } from './minimap-data.js';

describe('minimap geometry from the map', () => {
  it('merges test-town road tiles into row runs and boxes the building', async () => {
    const r = await validatePackDirs([BASE_PACK_DIR]);
    const data = r.maps.find((m) => m.id === 'base:test-town');
    if (!data) throw new Error('test-town missing');
    const { source, range } = mapDataToChunkSource(data);
    const g = minimapGeometry(source, range);
    expect(isRoadTile('base:asphalt')).toBe(true);
    expect(isRoadTile('base:grass')).toBe(false);
    // The y = 0 row is a full-width road (x −64..64).
    expect(g.roads).toContainEqual([
      { x: -64, z: 0.5 },
      { x: 64, z: 0.5 },
    ]);
    const tiles = g.roads.reduce((n, l) => n + ((l[1]?.x ?? 0) - (l[0]?.x ?? 0)), 0);
    expect(tiles).toBeGreaterThan(1000);
    // Villa: 10×8 plan at origin (11, 11).
    expect(g.buildings).toEqual([
      [
        { x: 11, z: 11 },
        { x: 21, z: 11 },
        { x: 21, z: 19 },
        { x: 11, z: 19 },
      ],
    ]);
  });
});
