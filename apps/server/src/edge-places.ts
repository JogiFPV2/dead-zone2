/**
 * Places files for the Edge Function: no filesystem there, so the files of
 * `packages/content/places` are bundled (`PLACES_FILES` of `@deadzone/content/places`). The Node
 * server reads them from disk with `createPlacesCache` of `@deadzone/content/node`.
 */
import {
  PLACES_FILES,
  placesFileFor,
  placesFileSchema,
  type Place,
} from '@deadzone/content/places';
import stalowaWola from '@deadzone/content/places/stalowa-wola.json' with { type: 'json' };

/** Bundled places files by file name; every `PLACES_FILES` entry must be here (test). */
export const BUNDLED_PLACES_FILES: Readonly<Record<string, unknown>> = {
  'stalowa-wola.json': stalowaWola,
};

/** `createPlacesCache` semantics over the bundled files: validated, frozen, parsed once. */
export function createBundledPlaces(
  files: Readonly<Record<string, unknown>> = BUNDLED_PLACES_FILES,
): (mapId: string | null | undefined) => Promise<readonly Place[] | null> {
  const cache = new Map<string, readonly Place[] | null>();
  return (mapId) => {
    const file = placesFileFor(mapId);
    if (!file || !Object.hasOwn(files, file)) return Promise.resolve(null);
    let hit = cache.get(file);
    if (hit === undefined) {
      const parsed = placesFileSchema.safeParse(files[file]);
      if (!parsed.success) return Promise.reject(new Error(`places/${file}: invalid`));
      hit = Object.freeze(parsed.data.map((p) => Object.freeze(p)));
      cache.set(file, hit);
    }
    return Promise.resolve(hit);
  };
}

export { PLACES_FILES };
