import { z } from 'zod';

/** Najdłuższy bok mebla w kaflach (1 kafel = 1 m). */
export const FOOTPRINT_MAX_TILES = 4;

/**
 * Rozmiar mebla w kaflach przy `rot = 0`: `w` wzdłuż lokalnej osi +x modelu (szerokość,
 * plecami do ściany), `h` wzdłuż lokalnej +z (głębokość, w stronę pokoju). Brak pola = 1×1.
 * Kotwica i obrót: `occupiedTiles` w `src/footprint/` i README („Footprint mebli”).
 */
export const FootprintSchema = z.strictObject({
  w: z.number().int().min(1).max(FOOTPRINT_MAX_TILES),
  h: z.number().int().min(1).max(FOOTPRINT_MAX_TILES),
});

export type Footprint = z.infer<typeof FootprintSchema>;
