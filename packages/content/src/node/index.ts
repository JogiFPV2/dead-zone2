import { buildContentBundle } from '../bundle/build-content-bundle.js';
import type { ContentBundle } from '../bundle/content-bundle.js';
import { validatePacks, type ValidationResult } from '../validate/validate-packs.js';
import { readPackDir } from './read-pack-dir.js';

export { readPackDir } from './read-pack-dir.js';
export { BASE_PACK_DIR } from './base-pack.js';
export { PLACES_DIR, loadPlaces, createPlacesCache } from './places.js';

/** Waliduje paczki z katalogów na dysku. */
export async function validatePackDirs(dirs: readonly string[]): Promise<ValidationResult> {
  return validatePacks(await Promise.all(dirs.map(readPackDir)));
}

/** `buildContentBundle` dla katalogów na dysku (serwer, narzędzia, testy). */
export async function buildContentBundleFromDirs(dirs: readonly string[]): Promise<ContentBundle> {
  return buildContentBundle(await Promise.all(dirs.map(readPackDir)));
}
