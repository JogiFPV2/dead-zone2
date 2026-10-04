import ChunkWorker from './chunk-worker.ts?worker';
import { GeneratedWorldSource } from './generated-source.js';
import { generatedMap, resolveSpec, type GeneratedMapSpec } from './maps.js';

export interface GeneratedWorld {
  spec: GeneratedMapSpec;
  source: GeneratedWorldSource;
}

/**
 * Opens a generated map by name (`?map=osm-stw`, `?map=plan-4`): starts the chunk worker and
 * waits for the world plan. Undefined for content maps. `?osmUrl=` points the OSM map at another
 * data file (dev, the full 16 km square).
 */
export async function openGeneratedWorld(
  name: string,
  query: string,
  baseUrl: string,
): Promise<GeneratedWorld | undefined> {
  const raw = generatedMap(name);
  if (!raw) return undefined;
  const spec = resolveSpec(raw, baseUrl, new URLSearchParams(query).get('osmUrl'));
  const source = await GeneratedWorldSource.open(spec, new ChunkWorker());
  return { spec, source };
}
