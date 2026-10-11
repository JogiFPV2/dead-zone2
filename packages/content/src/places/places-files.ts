/**
 * Rejestr plików miejsc: id mapy (`world_settings.map`) → plik w `packages/content/places/`.
 * Mapy bez wpisu (np. `test-town`, `plan-4`) nie mają nazw miejsc: `place` = null.
 */
export const PLACES_FILES: Readonly<Record<string, string>> = Object.freeze({
  'osm-stw': 'stalowa-wola.json',
});

/** Nazwa pliku miejsc dla mapy albo null, gdy mapa nie ma pliku. */
export function placesFileFor(mapId: string | null | undefined): string | null {
  if (typeof mapId !== 'string' || !Object.hasOwn(PLACES_FILES, mapId)) return null;
  return PLACES_FILES[mapId] ?? null;
}
