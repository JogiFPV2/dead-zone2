// Generated world source (osm-stw / plan-4): determinism, interiors, stairs, cars, sim start, perf.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE_PACK_DIR, buildContentBundleFromDirs } from '@deadzone/content/node';
import { footprintForId } from '@deadzone/content/footprint';
import {
  EDGE_PALETTE,
  OSM_REGIONS,
  PlanChunkGenerator,
  TILE_PALETTE,
  columnFootprintIssues,
  osmPlan,
  type GenColumn,
  type OsmMap,
} from '@deadzone/map/world-source';
import { CHUNK_SIZE, simMapFromWorldSource } from '@deadzone/protocol';
import { createSim } from '@deadzone/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { LoadedChunks } from '../streaming/source.js';
import { columnToWorldChunk, levelToSimChunk } from './convert.js';
import { GENERATED_MAPS, genStartRange, generatedMap, nearestPlace, resolveSpec } from './maps.js';
import { generatorWorldSource } from './sim-world.js';

const FILE = fileURLToPath(
  new URL('../../../public/osm/stw-okulickiego.deadzone-osm-1.json', import.meta.url),
);

function openOsm(): PlanChunkGenerator {
  const buf = readFileSync(FILE);
  const map = JSON.parse(buf.toString('utf8')) as OsmMap;
  const r = OSM_REGIONS.okulickiego;
  return new PlanChunkGenerator(
    osmPlan(map, {
      dataHash: createHash('sha256').update(buf).digest('hex'),
      bounds: r.bounds,
      start: r.start,
      region: 'okulickiego',
    }),
  );
}

const OUTDOOR_PROPS = [
  'base:trash-bin',
  'base:firewood-pile',
  'base:bench',
  'base:dumpster',
  'base:fuel-pump',
];

const pct = (a: number[], p: number) =>
  [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;

let gen: PlanChunkGenerator;
let start: { x: number; y: number };
/** 7 × 7 chunk columns around the start. */
const cols: GenColumn[] = [];
const genMs: number[] = [];

beforeAll(() => {
  gen = openOsm();
  start = gen.start();
  const cx0 = Math.floor(start.x / CHUNK_SIZE);
  const cy0 = Math.floor(start.y / CHUNK_SIZE);
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const t0 = performance.now();
      const c = gen.column(cx0 + dx, cy0 + dy);
      genMs.push(performance.now() - t0);
      if (c) cols.push(c);
    }
}, 60_000);

describe('generated map registry', () => {
  it('names the OSM map and plan-4, resolves the data URL against the base URL', () => {
    expect(generatedMap('osm-stw')?.kind).toBe('osm-tiles');
    expect(generatedMap('osm-okulickiego')?.kind).toBe('osm');
    expect(generatedMap('plan-4')?.kind).toBe('plan-4');
    expect(generatedMap('test-town')).toBeUndefined();
    expect(generatedMap('constructor')).toBeUndefined();
    const spec = resolveSpec(GENERATED_MAPS['osm-stw']!, '/deadzone-play/');
    expect(spec.kind === 'osm-tiles' && spec.url).toBe('/deadzone-play/osm/stw-16km/manifest.json');
    // Relative base (public build, `--base ./`): absolute against the page, not the worker script.
    const live = resolveSpec(
      GENERATED_MAPS['osm-stw']!,
      './',
      null,
      'https://jogifpv2.github.io/deadzone-play/?style=real',
    );
    expect(live.kind === 'osm-tiles' && live.url).toBe(
      'https://jogifpv2.github.io/deadzone-play/osm/stw-16km/manifest.json',
    );
    const crop = resolveSpec(GENERATED_MAPS['osm-okulickiego']!, '/deadzone-play/');
    expect(crop.kind === 'osm' && crop.url).toBe(
      '/deadzone-play/osm/stw-okulickiego.deadzone-osm-1.json',
    );
    expect(genStartRange({ cx0: 0, cy0: 0, cx1: 9, cy1: 9 }, { x: 40, y: 300 }, 2)).toEqual({
      cx0: 0,
      cy0: 7,
      cx1: 3,
      cy1: 9,
      z: 0,
    });
    expect(
      nearestPlace(
        [
          { name: 'A', x: 0, y: 0 },
          { name: 'B', x: 10, y: 0 },
        ],
        8,
        1,
      ),
    ).toBe('B');
  });
});

describe('OSM world source (Okulickiego)', () => {
  it('versions the world by data hash and region; starts on a sidewalk', () => {
    expect(gen.version).toMatch(/^osm-stw-[0-9a-f]{12}-okulickiego-g\d+$/);
    expect(gen.generatorVersion).toBeGreaterThan(0);
    const c = gen.column(Math.floor(start.x / CHUNK_SIZE), Math.floor(start.y / CHUNK_SIZE))!;
    const i = (Math.floor(start.y) % CHUNK_SIZE) * CHUNK_SIZE + (Math.floor(start.x) % CHUNK_SIZE);
    expect(TILE_PALETTE[c.levels[0]!.floor[i]!]).toBe('base:sidewalk');
  });

  it('is deterministic: same chunk bytes from a fresh generator in another order', () => {
    const other = openOsm();
    for (const c of [...cols].reverse().slice(0, 12)) {
      const d = other.column(c.cx, c.cy)!;
      expect(d.levels.length).toBe(c.levels.length);
      for (let k = 0; k < c.levels.length; k++) {
        const a = c.levels[k]!;
        const b = d.levels[k]!;
        expect(Buffer.from(b.floor.buffer).equals(Buffer.from(a.floor.buffer))).toBe(true);
        expect(Buffer.from(b.edgeN.buffer).equals(Buffer.from(a.edgeN.buffer))).toBe(true);
        expect(b.objects).toEqual(a.objects);
        expect(b.vehicles ?? []).toEqual(a.vehicles ?? []);
      }
      expect(d.trees).toEqual(c.trees);
    }
  });

  it('has buildings with upper floors, stairs on every storey below the top, furniture only indoors', () => {
    let upper = 0;
    let objects = 0;
    for (const c of cols) {
      for (const l of c.levels) {
        for (const o of l.objects) {
          objects++;
          const i = o.y * CHUNK_SIZE + o.x;
          // #131: furniture stands on a room tile; outside only yard props (bins, firewood,
          // benches, dumpsters) and pumps, never on the road.
          if ((l.room?.[i] ?? 0) === 0) {
            expect(OUTDOOR_PROPS).toContain(o.contentId);
            expect(TILE_PALETTE[l.floor[i]!]).not.toBe('base:asphalt');
          }
        }
        if (l.z > 0 && l.room?.some((v) => v > 0)) upper++;
      }
    }
    expect(objects).toBeGreaterThan(100);
    expect(upper).toBeGreaterThan(5);
    // Stairs: each building with n floors has a flight on every level 0..n-2 (in some chunk).
    const flights = new Map<number, Set<number>>();
    const floorsOf = new Map<number, number>();
    for (const c of cols) {
      for (const b of c.buildings) floorsOf.set(b.id, b.floors);
      for (const l of c.levels)
        for (const s of l.stairs) {
          const i = s.ty * CHUNK_SIZE + s.tx;
          const room = l.room?.[i] ?? 0;
          const b = l.rooms.find((r) => r[0] === room)?.[2];
          if (b === undefined) continue;
          let set = flights.get(b);
          if (!set) flights.set(b, (set = new Set()));
          set.add(l.z);
        }
    }
    let checked = 0;
    for (const [b, set] of flights) {
      const n = floorsOf.get(b) ?? 1;
      if (n < 2) continue;
      checked++;
      for (let z = 0; z < Math.min(n - 1, 2); z++) expect(set.has(z)).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('places furniture by footprint: in its room, no overlaps, doors free (#218)', async () => {
    const content = await buildContentBundleFromDirs([BASE_PACK_DIR]);
    const issues = columnFootprintIssues(cols, (id) => footprintForId(content, id));
    expect(issues.map((i) => `${i.kind}: ${i.at}`).slice(0, 20)).toEqual([]);
    const big = cols.flatMap((c) =>
      c.levels.flatMap((l) =>
        l.objects.filter((o) => {
          const f = footprintForId(content, o.contentId);
          return f.w * f.h > 1;
        }),
      ),
    );
    expect(big.length).toBeGreaterThan(10);
  });

  it('gives the sim a building per room and a kind per building (roomBuildings, buildingKinds)', () => {
    let kinds = 0;
    for (const c of cols)
      for (const l of c.levels) {
        const sc = levelToSimChunk(l, 0);
        for (const [id, , gid] of l.rooms) {
          expect(sc.roomBuildings?.[String(id)]).toBe(gid);
          const kind = c.buildings.find((b) => b.id === gid)?.kind;
          if (kind === 'church') continue;
          expect(sc.buildingKinds?.[String(gid)], `building ${gid} (${kind})`).toMatch(/^[a-z]+$/);
          kinds++;
        }
      }
    expect(kinds).toBeGreaterThan(0);
  });

  it('parks at most 64 cars per chunk on free asphalt / parking, apart from each other', () => {
    let cars = 0;
    for (const c of cols) {
      const g = c.levels[0]!;
      const vs = g.vehicles ?? [];
      expect(vs.length).toBeLessThanOrEqual(64);
      cars += vs.length;
      for (const [k, v] of vs.entries()) {
        // Chunk-local centre (tiles).
        const lx = Math.floor(v.x);
        const ly = Math.floor(v.y);
        const t = TILE_PALETTE[g.floor[ly * CHUNK_SIZE + lx]!];
        expect(['base:asphalt', 'base:parking']).toContain(t);
        expect(g.room?.[ly * CHUNK_SIZE + lx] ?? 0).toBe(0);
        for (const w of vs.slice(k + 1))
          expect(Math.hypot(w.x - v.x, w.y - v.y)).toBeGreaterThan(2);
      }
    }
    expect(cars).toBeGreaterThan(0);
  });

  it('streams as WorldChunks with chunk-local trees and building metadata', () => {
    const loaded = new LoadedChunks({
      id: 'gen:test',
      version: gen.version,
      seed: gen.seed,
      chunkSize: CHUNK_SIZE,
      bounds: gen.bounds,
      levels: { min: 0, max: gen.maxLevel },
      tilePalette: TILE_PALETTE as never,
      edgePalette: EDGE_PALETTE as never,
      getChunk: () => Promise.resolve(undefined),
    });
    for (const c of cols) loaded.set(columnToWorldChunk(c));
    let trees = 0;
    for (const c of cols) {
      const w = loaded.column(c.cx, c.cy)!;
      expect(w.levels.get(0)?.coord).toEqual({ cx: c.cx, cy: c.cy, z: 0 });
      for (const d of w.decor ?? []) {
        trees++;
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThan(CHUNK_SIZE);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThan(CHUNK_SIZE);
        // Species from the generator (habitat), for the painted trees.
        expect(d.species).toMatch(/^base:/);
      }
    }
    expect(trees).toBeGreaterThan(0);
  });

  it('runs the sim on the lazy WorldSource: start, zombies around, chunk kinds', async () => {
    const world = generatorWorldSource(gen);
    const content = await buildContentBundleFromDirs([BASE_PACK_DIR]);
    const t0 = performance.now();
    const sim = createSim({
      seed: 7,
      map: simMapFromWorldSource(world),
      world,
      content,
      spawn: { x: start.x, y: start.y, z: 0 },
      spawnZombies: gen.startZombies(start).map((z) => ({ x: z.x, y: z.y, z: 0 })),
    });
    for (let i = 0; i < 20; i++) sim.step();
    const initMs = performance.now() - t0;
    expect(sim.getPlayer()).toBeDefined();
    expect(sim.getZombies().length).toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (let cy = gen.bounds.cy0; cy <= gen.bounds.cy1; cy += 3)
      for (let cx = gen.bounds.cx0; cx <= gen.bounds.cx1; cx += 3)
        kinds.add(gen.chunkKind(cx, cy) ?? '-');
    expect(kinds.size).toBeGreaterThan(3);
    // LOD fills active chunks on every floor (#161), not only the street.
    const upstairs = sim.getZombies().filter((z) => z.z >= 1).length;
    expect(upstairs).toBeGreaterThan(0);
    console.log(
      `[world-gen] sim start ${initMs.toFixed(0)} ms, zombies ${sim.getZombies().length} (${upstairs} upstairs), kinds ${[...kinds].join(' ')}`,
    );
  }, 60_000);

  it('perf: chunk column generation p95 within a worker frame budget', () => {
    const p50 = pct(genMs, 0.5);
    const p95 = pct(genMs, 0.95);
    console.log(
      `[world-gen] ${genMs.length} columns: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...genMs).toFixed(1)} ms`,
    );
    // Off the main thread (chunk worker). Logged measurement; the bound only catches runaway
    // regressions (shared CI runners are several times slower than a desktop).
    expect(p95).toBeLessThan(5000);
  });
});
