import type { SimZombieSpawn } from '@deadzone/protocol';
import { CHUNK_SIZE, type ChunkData, type ChunkSource } from '../chunk.js';
import okulickiego from './scenes/osm-okulickiego.json';

/** Attribution shown on OSM maps and in the credits (ODbL 1.0). */
export const OSM_ATTRIBUTION = '© współtwórcy OpenStreetMap';

/**
 * OSM scene file (`tools/map/src/osm/scene.ts`, built with `pnpm --filter @deadzone/map
 * osm:scene`): what the content map `base:<map>` does not carry — player start, parked cars
 * (`SimChunk.vehicles`), zombies framed around the start, trees from OSM, the camera focus.
 * All positions in sim tiles of that map.
 */
export interface OsmScene {
  map: string;
  attribution: string;
  source: string;
  cut: { E: number; N: number; rotDeg: number; size: number };
  focus: { x: number; y: number };
  player: { x: number; y: number; heading: number };
  zombies: { x: number; y: number; heading: number }[];
  vehicles: { x: number; y: number; heading: number; type: string }[];
  trees: [number, number][];
  landmarks: { name: string; x: number; y: number }[];
}

const SCENES: Record<string, OsmScene> = {
  'osm-okulickiego': okulickiego as unknown as OsmScene,
};

/** Scene of content map `map` (`?map=osm-okulickiego`), if it is an OSM scene. */
export const osmScene = (map: string): OsmScene | undefined => SCENES[map];

/** Ids of the OSM scenes (menu background `?menuScene=`). */
export const OSM_SCENE_IDS = Object.keys(SCENES);

/** The map source with the scene's parked cars on level 0 (`ChunkData.vehicles`, local tiles). */
export function withSceneVehicles(source: ChunkSource, scene: OsmScene): ChunkSource {
  const byChunk = new Map<string, OsmScene['vehicles']>();
  for (const v of scene.vehicles) {
    const k = `${Math.floor(v.x / CHUNK_SIZE)},${Math.floor(v.y / CHUNK_SIZE)}`;
    byChunk.set(k, [...(byChunk.get(k) ?? []), v]);
  }
  const cache = new Map<string, ChunkData | undefined>();
  return {
    ...source,
    getChunk(cx, cy, z) {
      const key = `${cx},${cy},${z}`;
      if (cache.has(key)) return cache.get(key);
      const data = source.getChunk(cx, cy, z);
      const cars = z === 0 ? byChunk.get(`${cx},${cy}`) : undefined;
      const out =
        data && cars?.length
          ? {
              ...data,
              vehicles: cars.map((c) => ({
                x: c.x - cx * CHUNK_SIZE,
                y: c.y - cy * CHUNK_SIZE,
                heading: c.heading,
                type: c.type,
              })),
            }
          : data;
      cache.set(key, out);
      return out;
    },
  };
}

/** The scene's framed zombies as sim spawns (level 0). */
export const sceneZombies = (scene: OsmScene): SimZombieSpawn[] =>
  scene.zombies.map((z) => ({ x: z.x, y: z.y, z: 0 }));
