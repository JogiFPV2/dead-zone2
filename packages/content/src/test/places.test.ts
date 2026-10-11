import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPlacesCache, loadPlaces, PLACES_DIR } from '../node/index.js';
import {
  nearestPlace,
  PLACES_FILES,
  placeSchema,
  placesFileFor,
  placesFileSchema,
} from '../places/index.js';

describe('placeSchema', () => {
  it('przyjmuje format bazowy { name, x, y } i opcjonalne kind', () => {
    expect(placeSchema.parse({ name: 'Centrum', x: 1.5, y: -2 })).toEqual({
      name: 'Centrum',
      x: 1.5,
      y: -2,
    });
    expect(placeSchema.parse({ name: 'Pysznica', x: 0, y: 0, kind: 'village' }).kind).toBe(
      'village',
    );
  });
  it.each([
    ['pusta nazwa', { name: '  ', x: 0, y: 0 }],
    ['brak x', { name: 'A', y: 0 }],
    ['NaN', { name: 'A', x: Number.NaN, y: 0 }],
    ['Infinity', { name: 'A', x: 0, y: Number.POSITIVE_INFINITY }],
    ['string jako liczba', { name: 'A', x: '1', y: 0 }],
    ['zły kind', { name: 'A', x: 0, y: 0, kind: 'city' }],
  ])('odrzuca: %s', (_, v) => {
    expect(placeSchema.safeParse(v).success).toBe(false);
  });
  it('plik to tablica miejsc', () => {
    expect(placesFileSchema.safeParse({ name: 'A', x: 0, y: 0 }).success).toBe(false);
    expect(placesFileSchema.parse([])).toEqual([]);
  });
});

describe('nearestPlace', () => {
  const places = [
    { name: 'A', x: 0, y: 0 },
    { name: 'B', x: 10, y: 0 },
    { name: 'C', x: 10, y: 0 },
  ];
  it('zwraca najbliższe w linii prostej', () => {
    expect(nearestPlace(places, 1, 1)).toBe('A');
    expect(nearestPlace(places, 8, 3)).toBe('B');
  });
  it('remis: pierwsze z listy', () => {
    expect(nearestPlace(places, 5, 0)).toBe('A');
    expect(nearestPlace(places, 10, 0)).toBe('B');
  });
  it('pusta lista, null i undefined dają null', () => {
    expect(nearestPlace([], 0, 0)).toBeNull();
    expect(nearestPlace(null, 0, 0)).toBeNull();
    expect(nearestPlace(undefined, 0, 0)).toBeNull();
  });
});

describe('rejestr i loader plików miejsc', () => {
  it('osm-stw → stalowa-wola.json, inne mapy → null', () => {
    expect(placesFileFor('osm-stw')).toBe('stalowa-wola.json');
    expect(placesFileFor('test-town')).toBeNull();
    expect(placesFileFor('toString')).toBeNull();
    expect(placesFileFor(undefined)).toBeNull();
  });
  it('każdy plik z rejestru istnieje i przechodzi schemat', async () => {
    for (const file of Object.values(PLACES_FILES)) {
      const data = JSON.parse(await readFile(join(PLACES_DIR, file), 'utf8')) as unknown;
      expect(placesFileSchema.safeParse(data).success, file).toBe(true);
    }
  });
  it('wczytuje Stalową Wolę (zamrożone, niepuste)', async () => {
    const places = await loadPlaces('osm-stw');
    expect(places?.length).toBeGreaterThan(50);
    expect(Object.isFrozen(places)).toBe(true);
    expect(nearestPlace(places, 12831, 14497)).toBe('Centrum');
  });
  it('mapa bez wpisu albo brak pliku → null; zły plik → błąd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'places-'));
    expect(await loadPlaces('test-town')).toBeNull();
    expect(await loadPlaces('osm-stw', dir)).toBeNull();
    writeFileSync(join(dir, 'stalowa-wola.json'), '[{"name":"","x":0,"y":0}]');
    await expect(loadPlaces('osm-stw', dir)).rejects.toThrow(/stalowa-wola\.json/);
  });
  it('cache czyta plik raz na mapę', async () => {
    const get = createPlacesCache();
    expect(await get('osm-stw')).toBe(await get('osm-stw'));
    expect(await get(null)).toBeNull();
  });
});
