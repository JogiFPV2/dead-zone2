import { z } from 'zod';
import { ContentIdSchema } from './common/index.js';

/** Domyślne meble wysokie (zasłaniają wzrok przy włączonym `furnitureFootprint`). */
export const FURNITURE_TALL_DEFAULT = [
  'base:wardrobe',
  'base:bookshelf',
  'base:metal-shelf',
  'base:fridge',
  'base:freezer',
  'base:fridge-freezer',
  'base:locker',
  'base:gun-locker',
] as const;

/** Domyślne meble obsługiwane tylko z boku wzdłuż dłuższej krawędzi (lada: klient i sprzedawca). */
export const FURNITURE_LONG_SIDE_DEFAULT = ['base:shop-counter'] as const;

/**
 * `worldSettings.furnitureFootprint`: zajmowanie kafli przez meble (`footprint {w, h}` i `rot`
 * obiektu mapy, `@deadzone/content/footprint`). Mebel blokuje ruch i ścieżki na wszystkich
 * zajętych kaflach, wysoki (`furnitureTall`) zasłania też wzrok, a schowek i czynności są
 * dostępne z każdego kafla obok mebla (`furnitureLongSideAccess`: tylko wzdłuż dłuższych
 * krawędzi). Domyślnie włączone (od #249 mapy nie mają nachodzących na siebie mebli).
 */
export const FurnitureFootprintSchema = z.boolean().default(true);
/** Meble zasłaniające wzrok (szafy, regały, lodówki); reszta jest niższa od oczu. */
export const FurnitureTallSchema = z.array(ContentIdSchema).default([...FURNITURE_TALL_DEFAULT]);
/** Meble dostępne tylko z boku wzdłuż dłuższej krawędzi (z uwzględnieniem `rot`). */
export const FurnitureLongSideAccessSchema = z
  .array(ContentIdSchema)
  .default([...FURNITURE_LONG_SIDE_DEFAULT]);
