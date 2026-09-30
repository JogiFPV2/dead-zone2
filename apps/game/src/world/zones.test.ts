import { describe, expect, it } from 'vitest';
import { BASE_PACK_DIR, validatePackDirs } from '@deadzone/content/node';
import { CHUNK_SIZE, tileIndex } from './chunk.js';
import { mapDataToChunkSource, type LoadedMap } from './content-map.js';
import { startSpawn, zoneColor, zoneMeshData, type MapZone } from './zones.js';

async function load(id: string): Promise<LoadedMap> {
  const r = await validatePackDirs([BASE_PACK_DIR]);
  const data = r.maps.find((m) => m.id === id);
  if (!data) throw new Error(`${id} missing`);
  return mapDataToChunkSource(data);
}

const floorAt = (m: LoadedMap, x: number, y: number) => {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const c = m.source.getChunk(cx, cy, 0);
  const v = c?.floor[tileIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE)] ?? 0;
  return m.source.tilePalette[v];
};

describe('map zones from the manifest', () => {
  it('base:test-town carries start, villa and extraction; spawn lands on the street', async () => {
    const m = await load('base:test-town');
    expect(m.zones.map((z) => `${z.id}:${z.role}`)).toEqual([
      'start:start',
      'villa:villa',
      'extraction:extraction',
    ]);
    expect(m.zones[1]?.rects).toEqual([{ x: 11, y: 11, w: 10, h: 8 }]);
    const spawn = startSpawn(m.zones);
    expect(spawn).toEqual({ x: -60.5, y: 2.5, z: 0 });
    expect(floorAt(m, Math.floor(spawn!.x), Math.floor(spawn!.y))).toBe('base:asphalt');
  });

  it('base:demo-house has a start zone on the path outside the house', async () => {
    const m = await load('base:demo-house');
    const spawn = startSpawn(m.zones);
    expect(spawn).toEqual({ x: 13.5, y: 30.5, z: 0 });
    expect(floorAt(m, 13, 30)).toBe('base:concrete');
  });

  it('no start zone → no spawn (sim default)', () => {
    expect(startSpawn([])).toBeUndefined();
    expect(
      startSpawn([{ id: 'v', role: 'villa', z: 0, rects: [{ x: 0, y: 0, w: 1, h: 1 }] }]),
    ).toBeUndefined();
  });
});

describe('zone overlay data', () => {
  const zones: MapZone[] = [
    { id: 'a', role: 'start', z: 0, rects: [{ x: 1, y: 2, w: 3, h: 4 }] },
    {
      id: 'b',
      role: 'extraction',
      z: 1,
      rects: [
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 5, y: 5, w: 2, h: 1 },
      ],
    },
  ];

  it('builds one quad and four outline segments per rect in world space', () => {
    const d = zoneMeshData(zones, 3, 0);
    expect(d.positions).toHaveLength(3 * 12);
    expect(d.indices).toHaveLength(3 * 6);
    expect(d.outline).toHaveLength(3 * 24);
    // First rect: sim (1, 2) → world (1, 0, 2); far corner (4, 0, 6).
    expect([...d.positions.slice(0, 3)]).toEqual([1, 0, 2]);
    expect([...d.positions.slice(6, 9)]).toEqual([4, 0, 6]);
    // Level 1 is lifted by the level height.
    expect(d.positions[12 + 1]).toBe(3);
    expect(Math.max(...d.indices)).toBe(11);
  });

  it('colours by role: fixed for known roles, stable hash otherwise', () => {
    expect(zoneColor('start')).not.toBe(zoneColor('villa'));
    expect(zoneColor('loot')).toBe(zoneColor('loot'));
    expect(zoneColor('loot')).toBeGreaterThanOrEqual(0);
    expect(zoneColor('loot')).toBeLessThanOrEqual(0xffffff);
  });
});
