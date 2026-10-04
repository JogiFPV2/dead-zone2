import { CHUNK_SIZE, STAIR_STEP, decodeLayer } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { parseBlueprint } from './blueprint.js';
import { buildMap } from './build.js';
import { CATALOG, CATALOG_IDS, autoDoors, placeCatalog } from './catalog.js';

/** Walkable graph of a built map: floor tiles per level, blocking edges, stairs. */
function walk(type: string, rot: number) {
  const t = CATALOG[type]!;
  const p = placeCatalog(t, [4, 4], rot, 1, 1);
  const bp = parseBlueprint({
    id: 'unit',
    chunks: { cx0: 0, cy0: 0, cx1: 0, cy1: 0 },
    ground: 'base:grass',
    buildings: p.buildings,
    stairs: p.stairs,
  });
  const m = buildMap(bp);
  const floor = new Map<string, boolean>();
  const room = new Map<string, number>();
  const block = new Set<string>();
  const stairs: { x: number; y: number; z: number; dir: 'N' | 'E' | 'S' | 'W'; len: number }[] = [];
  for (const { json } of m.chunks) {
    const c = json;
    const z = c.address.z;
    const f = decodeLayer(c.layers.floor);
    const r = c.layers.room ? decodeLayer(c.layers.room) : undefined;
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      const k = `${i % CHUNK_SIZE},${Math.floor(i / CHUNK_SIZE)},${z}`;
      floor.set(k, (f[i] ?? 0) !== 0);
      if (r && r[i]) room.set(k, r[i]!);
    }
    for (const e of c.edges ?? []) {
      if (e.type === 'door') continue;
      block.add(`${e.x},${e.y},${e.side},${z}`);
    }
    for (const s of c.stairs ?? []) stairs.push({ x: s.tx, y: s.ty, z, dir: s.dir, len: s.len });
  }
  // Edge between (x, y) and its neighbour in direction (dx, dy) on level z.
  const blocked = (x: number, y: number, dx: number, dy: number, z: number) =>
    dx === 1
      ? block.has(`${x + 1},${y},w,${z}`)
      : dx === -1
        ? block.has(`${x},${y},w,${z}`)
        : dy === 1
          ? block.has(`${x},${y + 1},n,${z}`)
          : block.has(`${x},${y},n,${z}`);
  // BFS from outside (tile 0,0), over floors (holes are not walkable), stairs entry → exit.
  const seen = new Set<string>(['0,0,0']);
  const queue: [number, number, number][] = [[0, 0, 0]];
  while (queue.length > 0) {
    const [x, y, z] = queue.shift()!;
    const next: [number, number, number][] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE) continue;
      if (!floor.get(`${nx},${ny},${z}`) || blocked(x, y, dx, dy, z)) continue;
      next.push([nx, ny, z]);
    }
    for (const s of stairs) {
      const [dx, dy] = STAIR_STEP[s.dir];
      // Entry tile → exit tile on the next level.
      if (s.z === z && x === s.x - dx && y === s.y - dy) {
        next.push([s.x + dx * s.len, s.y + dy * s.len, z + 1]);
      }
    }
    for (const n of next) {
      const k = n.join(',');
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  const unreached = [...room.keys()].filter((k) => floor.get(k) && !seen.has(k));
  return { m, p, unreached, rooms: new Set(room.values()) };
}

describe('katalog budynków (12 typów)', () => {
  it('has the 12 types of the Designer sheet', () => {
    expect(CATALOG_IDS).toHaveLength(12);
  });

  for (const type of CATALOG_IDS) {
    for (const rot of [0, 1, 2, 3]) {
      it(`${type} rot ${rot}: builds, every room tile on every floor is reachable from outside`, () => {
        const { unreached, p, m } = walk(type, rot);
        expect(unreached).toEqual([]);
        const t = CATALOG[type]!;
        const levels = new Set(m.manifest.chunks.map((c) => c.z));
        expect(levels.size).toBe(t.floors);
        expect(p.rect.w * p.rect.h).toBe(t.w * t.d);
      });
    }
  }

  it('U stairs alternate columns and directions per floor', () => {
    const p = placeCatalog(CATALOG['hospital']!, [0, 0], 0, 1, 1);
    expect(p.stairs).toEqual([
      { at: [0, 11], dir: 'N', len: 4, zFrom: 0 },
      { at: [1, 8], dir: 'S', len: 4, zFrom: 1 },
      { at: [0, 11], dir: 'N', len: 4, zFrom: 2 },
    ]);
  });

  it('rotation turns stairs and footprint clockwise', () => {
    const p = placeCatalog(CATALOG['kostka']!, [10, 20], 1, 1, 1);
    expect(p.rect).toEqual({ x: 10, y: 20, w: 8, h: 8 });
    // (7, 6) N → (8 − 1 − 6, 7) E.
    expect(p.stairs).toEqual([{ at: [11, 27], dir: 'E', len: 3, zFrom: 0 }]);
  });

  it('auto doors link every room once (spanning tree)', () => {
    expect(autoDoors(['AAB', 'CCB'], 'A')).toHaveLength(2);
  });
});

describe('map town-catalog', () => {
  it('blueprint file is generated from the catalogue (run src/town-catalog-map.ts)', async () => {
    const { readFileSync } = await import('node:fs');
    const { TOWN_CATALOG_FILE, townCatalogBlueprint } = await import('./town-catalog-map.js');
    expect(JSON.parse(readFileSync(TOWN_CATALOG_FILE, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(townCatalogBlueprint())),
    );
  });
});
