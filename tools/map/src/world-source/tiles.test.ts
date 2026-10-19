import { CHUNK_SIZE } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import type { OsmBuilding, OsmMap } from '../osm/types.js';
import { OSM_REGIONS, osmPlan } from './sources.js';
import { PlanChunkGenerator } from './generator.js';
import { rotatePt, rotation, OSM_ROTATION_DEG } from './straighten.js';
import {
  OSM_TILE_SIZE,
  OsmTiles,
  packKinds,
  splitOsmMap,
  unpackKinds,
  type OsmTileManifest,
} from './tiles.js';

/** Small raw-frame map: a long street, a 2.5 km forest, a river, houses along the street. */
function sample(): OsmMap {
  const rect = (x: number, y: number, w: number, h: number) =>
    [x, y, x + w, y, x + w, y + h, x, y + h, x, y].map((v) => v * 10);
  const buildings: OsmBuilding[] = [];
  for (let i = 0; i < 60; i++) {
    const x = 7000 + i * 41;
    buildings.push({
      id: 1000 - i,
      type: 'house',
      kind: i % 7 ? 'house' : 'block',
      typeFrom: 'tag',
      levels: i % 7 ? 2 : 5,
      levelsFrom: 'tag',
      rings: [rect(x, i % 2 ? 8212 : 8180, 14, 10)],
    });
  }
  const forest: number[] = [];
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const rr = 1250 + 180 * Math.sin(a * 3);
    forest.push(
      Math.round((8300 + Math.cos(a) * rr) * 10),
      Math.round((9200 + Math.sin(a) * rr) * 10),
    );
  }
  forest.push(forest[0]!, forest[1]!);
  const trees: number[] = [];
  for (let i = 0; i < 200; i++) trees.push((7000 + i * 13) * 10, 8235 * 10);
  return {
    format: 'deadzone-osm-1',
    crs: 'EPSG:32634',
    E0: 0,
    N1: 0,
    size: 16384,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    source: 'test',
    roads: [
      { id: 1, kind: 'residential', width: 7, sidewalk: 2, pts: [70000, 82000, 95000, 82050] },
      { id: 2, kind: 'service', width: 4, sidewalk: 0, pts: [80000, 82000, 80000, 76000] },
    ],
    rails: [],
    waterways: [
      {
        id: 3,
        kind: 'river',
        width: 30,
        pts: [60000, 70000, 80000, 72000, 100000, 69000, 120000, 75000],
      },
    ],
    areas: [{ id: 4, kind: 'forest', rings: [forest] }],
    buildings,
    trees,
    treeRows: [],
    pois: [],
    places: [{ name: 'Testowo', kind: 'village', x: 80000, y: 82000 }],
  };
}

function tiled(map: OsmMap, order: (keys: string[]) => string[]) {
  const { tiles, kinds } = splitOsmMap(map);
  const manifest: OsmTileManifest = {
    format: 'deadzone-osm-tiles-1',
    crs: map.crs,
    E0: 0,
    N1: 0,
    size: map.size,
    attribution: map.attribution,
    license: map.license,
    source: map.source,
    worldSize: 22528,
    rotationDeg: OSM_ROTATION_DEG,
    tileSize: OSM_TILE_SIZE,
    places: map.places,
    kinds: packKinds(kinds),
    tiles: [...tiles.keys()].map((k) => {
      const [tx, ty] = k.split(',').map(Number) as [number, number];
      return { tx, ty, file: k, bytes: 0, sha256: '' };
    }),
    dataHash: 'test',
  };
  const t = new OsmTiles(manifest, (file) => Promise.resolve(tiles.get(file)!));
  return { t, keys: order([...tiles.keys()]), kinds };
}

/** Chunks along the street and inside the forest (world frame). */
function chunks(): [number, number][] {
  const r = rotation(OSM_ROTATION_DEG);
  const out: [number, number][] = [];
  for (const [x, y] of [
    [7100, 8200],
    [8000, 8200],
    [8010, 7900],
    [9300, 8200],
    [8300, 9200],
    [7700, 7050],
  ] as const) {
    const p = rotatePt(r, x, y);
    out.push([Math.floor(p.x / CHUNK_SIZE), Math.floor(p.y / CHUNK_SIZE)]);
  }
  return out;
}

describe('OSM tiles (lazy loading of the whole square)', () => {
  it('kinds pack and unpack losslessly', () => {
    const k = new Uint8Array(5000).map((_, i) => (i % 700 < 300 ? 3 : i % 7));
    expect(unpackKinds(packKinds(k), k.length)).toEqual(k);
  });

  it('chunks do not depend on the order tiles arrive in', async () => {
    const m = sample();
    const a = tiled(m, (k) => k);
    const b = tiled(m, (k) => [...k].reverse());
    for (const [cx, cy] of chunks()) {
      await a.t.ensure(cx, cy);
    }
    await b.t.ensureAll();
    for (const [cx, cy] of chunks()) {
      expect(a.t.ready(cx, cy)).toBe(true);
      expect(b.t.generator.column(cx, cy)).toEqual(a.t.generator.column(cx, cy));
    }
  }, 60_000);

  it('a tiled chunk equals the chunk of the whole-map plan', async () => {
    const m = sample();
    const { t, kinds } = tiled(m, (k) => k);
    await t.ensureAll();
    const full = new PlanChunkGenerator(
      osmPlan(m, { dataHash: 'x', region: 'all', ...OSM_REGIONS.all }),
    );
    for (const [cx, cy] of chunks()) {
      expect(t.generator.column(cx, cy)).toEqual(full.column(cx, cy));
      expect(t.generator.chunkKind(cx, cy)).toBe(full.chunkKind(cx, cy));
    }
    expect(kinds).toEqual(full.computeKinds());
  }, 60_000);
});
