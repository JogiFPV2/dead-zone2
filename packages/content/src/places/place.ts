import { z } from 'zod';

/** Rodzaj miejsca (opcjonalny; pliki z OSM mają sam `{ name, x, y }`). */
export const PLACE_KINDS = ['district', 'town', 'village'] as const;
export const placeKindSchema = z.enum(PLACE_KINDS);

/**
 * Nazwane miejsce na mapie: dzielnica, miasto, wieś. `x`, `y` w kaflach (1 kafel = 1 m),
 * x na wschód, y na południe, ten sam układ co mapa świata. Nieznane pola są pomijane (nie odrzucane),
 * żeby generator mógł dopisywać metadane bez łamania starszych czytelników.
 */
// zod v4: `z.number()` odrzuca NaN i ±Infinity.
export const placeSchema = z.object({
  name: z.string().trim().min(1),
  x: z.number(),
  y: z.number(),
  kind: placeKindSchema.optional(),
});

/** Plik miejsc jednej mapy, np. `places/stalowa-wola.json`: tablica miejsc. */
export const placesFileSchema = z.array(placeSchema);

export type PlaceKind = z.infer<typeof placeKindSchema>;
export type Place = z.infer<typeof placeSchema>;
export type PlacesFile = z.infer<typeof placesFileSchema>;
