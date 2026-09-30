import { validatePacks } from '@deadzone/content';
import { mapDataToChunkSource, type LoadedMap } from './content-map.js';

/** Loads and validates the base pack in the browser and returns map `base:<name>` (`?map=…`). */
export async function loadBaseMap(name: string): Promise<LoadedMap> {
  const { BASE_PACK_DIR, baseFiles } = await import('../content/base-pack.js');
  const result = validatePacks([{ dir: BASE_PACK_DIR, files: baseFiles }]);
  if (!result.ok) {
    throw new Error(`base pack invalid: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  const map = result.maps.find((m) => m.id === `base:${name}`);
  if (!map) throw new Error(`map base:${name} not found`);
  return mapDataToChunkSource(map);
}
