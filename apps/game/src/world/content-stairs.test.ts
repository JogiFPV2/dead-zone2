import { simMapFromData } from '@deadzone/protocol';
import { BASE_PACK_DIR, validatePackDirs } from '@deadzone/content/node';
import { expect, it } from 'vitest';
import { tileIndex } from './chunk.js';
import { mapDataToChunkSource } from './content-map.js';
import { chunkSourceToSimMapData } from './sim-map.js';

it('content stairs and fences reach the sim 1:1 (content → ChunkSource → SimMapData)', async () => {
  const r = await validatePackDirs([BASE_PACK_DIR]);
  const base = r.maps.find((m) => m.id === 'base:demo-house');
  if (!base) throw new Error('demo-house missing');
  expect(base.chunks.every((c) => !c.stairs?.length)).toBe(true);
  const stairs = [
    { tx: 3, ty: 20, dir: 'N' as const, len: 4 },
    { tx: 28, ty: 2, dir: 'E' as const, len: 6 },
  ];
  const fence = { x: 2, y: 30, side: 'n' as const, type: 'fence' as const };
  const data = {
    ...base,
    chunks: base.chunks.map((c) => ({
      ...c,
      stairs,
      edges: [...c.edges, { ...fence, contentId: 'base:wooden-fence' }],
    })),
  };
  const { source, range } = mapDataToChunkSource(data);
  const c = source.getChunk(0, 0, 0)!;
  expect(c.stairs).toEqual(stairs);
  expect(source.edgePalette?.[c.edgeN?.[tileIndex(2, 30)] ?? 0]).toEqual({
    id: 'base:wooden-fence',
    kind: 'fence',
  });

  const sim = simMapFromData(chunkSourceToSimMapData(source, range));
  expect(sim.getChunk(0, 0, 0)?.stairs).toEqual(stairs);
  // Maps without stairs keep chunks without the field.
  const plain = mapDataToChunkSource(base);
  expect(plain.source.getChunk(0, 0, 0)?.stairs).toBeUndefined();
  const plainSim = simMapFromData(chunkSourceToSimMapData(plain.source, plain.range));
  expect(plainSim.getChunk(0, 0, 0)?.stairs).toBeUndefined();
});
