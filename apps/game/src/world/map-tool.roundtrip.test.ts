// Round trip: blueprint (tools/map) -> chunked map JSON -> content validation -> game converter.
import { describe, expect, it } from 'vitest';
import { MapChunkSchema, MapManifestSchema, type MapData } from '@deadzone/content';
import { BASE_PACK_DIR, readPackDir, validatePackDirs } from '@deadzone/content/node';
import { buildMap, mapFiles, parseBlueprint, validateWithPack } from '@deadzone/map';
import demoHouse from '@deadzone/map/blueprints/demo-house.json';
import testTown from '@deadzone/map/blueprints/test-town.json';
import { CHUNK_TILES, type ChunkSource } from './chunk.js';
import { mapDataToChunkSource } from './content-map.js';
import { TEST_MAP_RANGE, createTestMap } from './test-map.js';

/** Content ids per tile and edge of one chunk, so different palettes compare equal. */
function view(source: ChunkSource, cx: number, cy: number) {
  const c = source.getChunk(cx, cy, 0);
  if (!c) return undefined;
  const tiles = (layer: Uint16Array | undefined) =>
    Array.from(layer ?? new Uint16Array(CHUNK_TILES), (v) => source.tilePalette[v] ?? null);
  const edges = (layer: Uint16Array | undefined) =>
    Array.from(layer ?? new Uint16Array(CHUNK_TILES), (v) => source.edgePalette?.[v] ?? null);
  return {
    floor: tiles(c.floor),
    roof: tiles(c.roof),
    room: Array.from(c.room ?? new Uint16Array(CHUNK_TILES)),
    edgeN: edges(c.edgeN),
    edgeW: edges(c.edgeW),
    rooms: [...(c.rooms ?? new Map<number, unknown>())].filter(([id]) => c.room?.includes(id)),
  };
}

describe('map tool round trip', () => {
  it('test-town blueprint reproduces the generated test map tile for tile', async () => {
    const built = buildMap(parseBlueprint(testTown));
    const files = await mapFiles(built);
    // Schema-level parse (the test map uses placeholder ids that content does not define yet).
    const data: MapData = {
      id: 'dev:test-town',
      pack: 'dev',
      folder: 'test-town',
      manifest: MapManifestSchema.parse(JSON.parse(files[0]?.text ?? '')),
      chunks: files.slice(1).map((f) => MapChunkSchema.parse(JSON.parse(f.text))),
      chunkFiles: files.slice(1).map((f) => f.path),
    };
    const { source, range } = mapDataToChunkSource(data);
    expect(range).toEqual(TEST_MAP_RANGE);
    const generated = createTestMap();
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        expect(view(source, cx, cy), `chunk ${cx},${cy}`).toEqual(view(generated, cx, cy));
      }
    }
  });

  it('demo-house blueprint validates with the base pack and loads like the shipped map', async () => {
    const built = buildMap(parseBlueprint(demoHouse));
    const result = validateWithPack(
      await mapFiles(built),
      built.id,
      await readPackDir(BASE_PACK_DIR),
    );
    expect(result.errors).toEqual([]);
    const fromTool = result.maps.find((m) => m.id === 'base:demo-house');
    const shipped = (await validatePackDirs([BASE_PACK_DIR])).maps.find(
      (m) => m.id === 'base:demo-house',
    );
    if (!fromTool || !shipped) throw new Error('demo-house missing');
    expect(view(mapDataToChunkSource(fromTool).source, 0, 0)).toEqual(
      view(mapDataToChunkSource(shipped).source, 0, 0),
    );
  });
});
