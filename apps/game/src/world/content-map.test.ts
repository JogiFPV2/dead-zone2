import { expect, it } from 'vitest';
import { BASE_PACK_DIR, validatePackDirs } from '@deadzone/content/node';
import { tileIndex } from './chunk.js';
import { BuildingLookup } from './building-lookup.js';
import { mapDataToChunkSource } from './content-map.js';

it('converts base:demo-house into a ChunkSource (1-based palettes, sparse edges, rooms)', async () => {
  const r = await validatePackDirs([BASE_PACK_DIR]);
  const data = r.maps.find((m) => m.id === 'base:demo-house');
  if (!data) throw new Error('demo-house missing');
  const { source, range } = mapDataToChunkSource(data);
  expect(range).toEqual({ cx0: 0, cy0: 0, cx1: 0, cy1: 0, z: 0 });
  const c = source.getChunk(0, 0, 0);
  if (!c) throw new Error('chunk missing');
  expect(source.tilePalette[0]).toBeNull();
  expect(source.tilePalette[c.floor[tileIndex(0, 0)] ?? 0]).toBe('base:grass');
  expect(source.tilePalette[c.floor[tileIndex(12, 12)] ?? 0]).toBe('base:kitchen-tiles');
  expect(c.roof?.some((v) => source.tilePalette[v] === 'base:roof-shingles')).toBe(true);

  const kinds = new Set(
    [...(c.edgeN ?? []), ...(c.edgeW ?? [])].map((id) => source.edgePalette?.[id]?.kind),
  );
  expect(kinds).toEqual(new Set([undefined, 'wall', 'window', 'door']));
  const first = data.chunks[0]?.edges[0];
  if (!first) throw new Error('no edges');
  const layer = first.side === 'n' ? c.edgeN : c.edgeW;
  expect(source.edgePalette?.[layer?.[tileIndex(first.x, first.y)] ?? 0]).toEqual({
    id: first.contentId,
    kind: first.type,
  });
  expect(new BuildingLookup(source).at(12, 12, 0)).toBe(1);
  expect(source.getChunk(1, 0, 0)).toBeUndefined();
});

it('passes content stairs through to the chunk (for the sim)', async () => {
  const r = await validatePackDirs([BASE_PACK_DIR]);
  const data = r.maps.find((m) => m.id === 'base:demo-house');
  if (!data) throw new Error('demo-house missing');
  const first = data.chunks[0]!;
  const stairs = [{ tx: 2, ty: 3, dir: 'N' as const, len: 3 }];
  const { source } = mapDataToChunkSource({ ...data, chunks: [{ ...first, stairs }] });
  const { cx, cy, z } = first.address;
  expect(source.getChunk(cx, cy, z)?.stairs).toEqual(stairs);
  expect(mapDataToChunkSource(data).source.getChunk(cx, cy, z)?.stairs).toBeUndefined();
});
