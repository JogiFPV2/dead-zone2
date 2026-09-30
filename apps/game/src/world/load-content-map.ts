import { validatePacks, type PackFile } from '@deadzone/content';
import { mapDataToChunkSource, type LoadedMap } from './content-map.js';

// Lazy: the base pack JSON is only fetched when a content map is requested (`?map=…`).
const BASE_PACK = import.meta.glob<unknown>('../../../../packages/content/data/base/**/*.json', {
  import: 'default',
});
const BASE_PREFIX = '../../../../packages/content/data/base/';

/** Loads and validates the base pack in the browser and returns map `base:<name>`. */
export async function loadBaseMap(name: string): Promise<LoadedMap> {
  const files: PackFile[] = await Promise.all(
    Object.entries(BASE_PACK).map(async ([path, load]) => ({
      path: path.slice(BASE_PREFIX.length),
      json: await load(),
    })),
  );
  const result = validatePacks([{ dir: 'base', files }]);
  if (!result.ok) {
    throw new Error(`base pack invalid: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  const map = result.maps.find((m) => m.id === `base:${name}`);
  if (!map) throw new Error(`map base:${name} not found`);
  return mapDataToChunkSource(map);
}
