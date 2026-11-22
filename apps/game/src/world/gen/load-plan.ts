import {
  OSM_REGIONS,
  OSM_TILES_FORMAT,
  OsmTiles,
  PlanChunkGenerator,
  osmPlan,
  plan4Plan,
  type OsmMap,
  type OsmTileManifest,
} from '@deadzone/map/world-source';
import type { GeneratedMapSpec } from './maps.js';

/** Hex SHA-256 of the data file (its version: any data change refuses old saves). */
async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Tile bytes as JSON bytes: gzip (stw2 `.json.gz`, unless the server already inflated it). */
export async function inflateTile(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf);
  if (u.length < 2 || u[0] !== 0x1f || u[1] !== 0x8b) return buf;
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).arrayBuffer();
}

/** A loaded generated world: the generator and, for the tiled OSM map, its tile loader. */
export interface LoadedGenerator {
  gen: PlanChunkGenerator;
  /** Lazily loaded OSM tiles (`ensure` before generating a chunk); absent = all data in. */
  tiles?: OsmTiles;
}

/**
 * The chunk generator of a generated map (used by both workers: client chunks and the sim).
 * OSM: fetches the data (static, ODbL) and versions the world by its hash; the 16 km square
 * comes as a manifest + 1 km tiles, only the tiles around the start are awaited (`tiles.ensure`
 * loads the rest on demand); plan-4: plans the world from its seed.
 */
export async function loadWorld(
  spec: GeneratedMapSpec,
  fetchFn: typeof fetch = fetch,
  /** Tiles awaited around the start: the start's 3 × 3 tiles, ± this many more (km). */
  startRadius = 0,
): Promise<LoadedGenerator> {
  if (spec.kind === 'plan-4')
    return { gen: new PlanChunkGenerator(plan4Plan(spec.seed, spec.size)) };
  const res = await fetchFn(spec.url);
  if (!res.ok) throw new Error(`mapa OSM: ${spec.url} → HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (spec.kind === 'osm-tiles') {
    const manifest = JSON.parse(new TextDecoder().decode(buf)) as OsmTileManifest;
    if (manifest.format !== OSM_TILES_FORMAT)
      throw new Error(`mapa OSM: nieznany format ${String(manifest.format)}`);
    const base = spec.url.slice(0, spec.url.lastIndexOf('/') + 1);
    const hashes = new Map(manifest.tiles.map((t) => [t.file, t.sha256]));
    const tiles = new OsmTiles(manifest, async (file) => {
      const r = await fetchFn(base + file);
      if (!r.ok) throw new Error(`mapa OSM: ${file} → HTTP ${r.status}`);
      const b = await inflateTile(await r.arrayBuffer());
      if ((await sha256(b)) !== hashes.get(file))
        throw new Error(`mapa OSM: ${file} nie zgadza się z manifestem`);
      return JSON.parse(new TextDecoder().decode(b)) as OsmMap;
    });
    const s = tiles.generator.plan.start;
    const C = 32;
    const T = manifest.tileSize / C;
    const scx = Math.floor(s.x / C);
    const scy = Math.floor(s.y / C);
    const near: Promise<void>[] = [];
    for (let dy = -startRadius; dy <= startRadius; dy++)
      for (let dx = -startRadius; dx <= startRadius; dx++)
        near.push(tiles.ensure(scx + dx * T, scy + dy * T));
    await Promise.all(near);
    return { gen: tiles.generator, tiles };
  }
  const map = JSON.parse(new TextDecoder().decode(buf)) as OsmMap;
  if (map.format !== 'deadzone-osm-1')
    throw new Error(`mapa OSM: nieznany format ${String(map.format)}`);
  const region = OSM_REGIONS[spec.region];
  return {
    gen: new PlanChunkGenerator(
      osmPlan(map, {
        dataHash: await sha256(buf),
        bounds: region.bounds,
        start: region.start,
        region: spec.region,
      }),
    ),
  };
}

/** The generator alone (all data in: tiled maps load every tile first). */
export async function loadGenerator(
  spec: GeneratedMapSpec,
  fetchFn: typeof fetch = fetch,
): Promise<PlanChunkGenerator> {
  const w = await loadWorld(spec, fetchFn);
  await w.tiles?.ensureAll();
  return w.gen;
}
