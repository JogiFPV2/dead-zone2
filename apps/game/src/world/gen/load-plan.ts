import {
  OSM_REGIONS,
  PlanChunkGenerator,
  osmPlan,
  plan4Plan,
  type OsmMap,
} from '@deadzone/map/world-source';
import type { GeneratedMapSpec } from './maps.js';

/** Hex SHA-256 of the data file (its version: any data change refuses old saves). */
async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The chunk generator of a generated map (used by both workers: client chunks and the sim).
 * OSM: fetches the data file (static, ODbL) and versions the world by its hash; plan-4: plans
 * the world from its seed.
 */
export async function loadGenerator(
  spec: GeneratedMapSpec,
  fetchFn: typeof fetch = fetch,
): Promise<PlanChunkGenerator> {
  if (spec.kind === 'plan-4') return new PlanChunkGenerator(plan4Plan(spec.seed, spec.size));
  const res = await fetchFn(spec.url);
  if (!res.ok) throw new Error(`mapa OSM: ${spec.url} → HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const map = JSON.parse(new TextDecoder().decode(buf)) as OsmMap;
  if (map.format !== 'deadzone-osm-1')
    throw new Error(`mapa OSM: nieznany format ${String(map.format)}`);
  const region = OSM_REGIONS[spec.region];
  return new PlanChunkGenerator(
    osmPlan(map, {
      dataHash: await sha256(buf),
      bounds: region.bounds,
      start: region.start,
      region: spec.region,
    }),
  );
}
