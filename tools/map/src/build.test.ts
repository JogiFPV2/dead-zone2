import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MapChunkSchema, tileIndex, type MapChunk } from '@deadzone/content';
import { BASE_PACK_DIR, readPackDir } from '@deadzone/content/node';
import { describe, expect, it } from 'vitest';
import { parseBlueprint, type BlueprintInput } from './blueprint.js';
import { buildMap } from './build.js';
import { mapFiles } from './files.js';
import { formatErrors, validateSchemasOnly, validateWithPack } from './validate.js';

const blueprint = async (name: string) =>
  parseBlueprint(
    JSON.parse(await readFile(new URL(`../blueprints/${name}.json`, import.meta.url), 'utf8')),
  );

const parseChunk = (json: unknown): MapChunk => MapChunkSchema.parse(json);

/** Content-id view of a chunk, independent of palette order, layer encoding and edge order. */
function semantic(c: MapChunk) {
  const ids = (layer: Uint16Array | undefined) =>
    Array.from(layer ?? new Uint16Array(1024), (v) => (v === 0 ? null : c.palette[v - 1]));
  return {
    address: c.address,
    floor: ids(c.layers.floor),
    roof: ids(c.layers.roof),
    room: Array.from(c.layers.room ?? new Uint16Array(1024)),
    edges: c.edges.map((e) => `${e.x},${e.y},${e.side},${e.type},${e.contentId}`).sort(),
    objects: c.objects,
    rooms: c.rooms,
  };
}

const small = (over: Partial<BlueprintInput> = {}): BlueprintInput => ({
  id: 'unit',
  chunks: { cx0: 0, cy0: 0, cx1: 1, cy1: 0 },
  ground: 'base:grass',
  buildings: [
    {
      id: 5,
      origin: [30, 4],
      plan: ['AAAA', 'AA..'],
      rooms: { A: { id: 9, type: 'base:room-kitchen', floor: 'base:kitchen-tiles' } },
      wall: 'base:brick-wall',
      door: 'base:wooden-door',
      openings: [{ at: [3, 0], side: 'e', type: 'door' }],
    },
  ],
  ...over,
});

describe('buildMap', () => {
  it('reproduces base:demo-house from its blueprint and validates against the base pack', async () => {
    const built = buildMap(await blueprint('demo-house'));
    const base = await readPackDir(BASE_PACK_DIR);
    const result = validateWithPack(await mapFiles(built), built.id, base);
    expect(formatErrors(result)).toEqual([]);

    const dir = join(BASE_PACK_DIR, 'maps/demo-house');
    const manifest: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    expect(built.manifest).toEqual(manifest);
    const original = parseChunk(JSON.parse(await readFile(join(dir, 'chunks/0_0_0.json'), 'utf8')));
    expect(semantic(parseChunk(built.chunks[0]?.json))).toEqual(semantic(original));
  });

  it('is deterministic', async () => {
    const bp = await blueprint('test-town');
    const a = await mapFiles(buildMap(bp));
    const b = await mapFiles(buildMap(bp));
    expect(a.map((f) => f.path)).toHaveLength(17);
    expect(a).toEqual(b);
    expect(validateSchemasOnly(a)).toEqual([]);
  });

  it('generates walls on room borders, stores s/e as n/w of the neighbour, across chunks', () => {
    const built = buildMap(parseBlueprint(small()));
    const [left, right] = built.chunks.map((c) => parseChunk(c.json));
    if (!left || !right) throw new Error('chunks');
    const edges = (c: MapChunk) => c.edges.map((e) => `${e.x},${e.y},${e.side}:${e.type}`);
    // Tiles x 30..33 cross the chunk border at x = 32; the east door of (33, 4) is W of (34, 4).
    expect(edges(left)).toEqual([
      '30,4,n:wall',
      '30,4,w:wall',
      '30,5,w:wall',
      '30,6,n:wall',
      '31,4,n:wall',
      '31,6,n:wall',
    ]);
    expect(edges(right)).toEqual([
      '0,4,n:wall',
      '0,5,n:wall',
      '0,5,w:wall', // east wall of (31, 5) lives in the right chunk
      '1,4,n:wall',
      '1,5,n:wall',
      '2,4,w:door',
    ]);
    expect(right.rooms).toEqual({ '9': { roomType: 'base:room-kitchen', buildingId: 5 } });
    expect(right.layers.room?.[tileIndex(1, 4)]).toBe(9);
    expect(right.layers.room?.[tileIndex(1, 5)]).toBe(0);
    expect(left.palette).toEqual(['base:grass', 'base:kitchen-tiles']);
  });

  it('rejects bad blueprints with readable errors', () => {
    const b = small().buildings![0]!;
    expect(() => buildMap(parseBlueprint(small({ buildings: [{ ...b, plan: ['AX'] }] })))).toThrow(
      /„X”/,
    );
    expect(() =>
      buildMap(
        parseBlueprint(
          small({ buildings: [{ ...b, openings: [{ at: [1, 0], side: 's', type: 'door' }] }] }),
        ),
      ),
    ).toThrow(/nie leży na ścianie/);
    expect(() =>
      buildMap(parseBlueprint(small({ buildings: [{ ...b, origin: [62, 0] }] }))),
    ).toThrow(/poza mapą/);
    expect(() => parseBlueprint({ id: 'Bad Id' })).toThrow(/blueprint/);
  });

  it('reports missing content refs through full pack validation', async () => {
    const built = buildMap(await blueprint('test-town'));
    const result = validateWithPack(
      await mapFiles(built),
      built.id,
      await readPackDir(BASE_PACK_DIR),
    );
    expect(result.ok).toBe(false);
    expect(formatErrors(result).join('\n')).toMatch(/base:asphalt/);
  });
});
