import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placesFileSchema, type Place } from '../places/place.js';
import { placesFileFor } from '../places/places-files.js';

/** Katalog `places/` paczki (działa z `src/node/` i z `dist/node/`). */
export const PLACES_DIR = fileURLToPath(new URL('../../places', import.meta.url));

/**
 * Miejsca mapy `mapId` z `places/<plik>.json`, zwalidowane `placesFileSchema` i zamrożone.
 * null, gdy mapa nie ma wpisu w `PLACES_FILES` albo pliku jeszcze nie ma (ENOENT).
 * Uszkodzony plik (zły JSON albo schemat) rzuca błąd: to błąd danych, nie brak danych.
 */
export async function loadPlaces(
  mapId: string | null | undefined,
  dir = PLACES_DIR,
): Promise<readonly Place[] | null> {
  const file = placesFileFor(mapId);
  if (!file) return null;
  let text: string;
  try {
    text = await readFile(join(dir, file), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const parsed = placesFileSchema.safeParse(JSON.parse(text) as unknown);
  if (!parsed.success) throw new Error(`places/${file}: ${parsed.error.message}`);
  return Object.freeze(parsed.data.map((p) => Object.freeze(p)));
}

/** `loadPlaces` z pamięcią podręczną per id mapy (serwer: jeden odczyt pliku na proces). */
export function createPlacesCache(
  dir = PLACES_DIR,
): (mapId: string | null | undefined) => Promise<readonly Place[] | null> {
  const cache = new Map<string, Promise<readonly Place[] | null>>();
  return (mapId) => {
    const key = typeof mapId === 'string' ? mapId : '';
    let hit = cache.get(key);
    if (!hit) {
      hit = loadPlaces(mapId, dir);
      hit.catch(() => cache.delete(key));
      cache.set(key, hit);
    }
    return hit;
  };
}
