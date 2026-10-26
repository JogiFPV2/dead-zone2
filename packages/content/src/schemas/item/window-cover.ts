import { z } from 'zod';

/** Domyślnie zasłonięte okno blokuje wzrok. */
export const DEFAULT_WINDOW_COVER_BLOCKS_SIGHT = true;
/** Domyślny ułamek światła przechodzący przez zasłonięte okno (0 = nic, 1 = całe). */
export const DEFAULT_WINDOW_COVER_LIGHT_PASS = 0;
/** Domyślny czas zawieszenia przedmiotu na oknie (sekundy gry). */
export const DEFAULT_WINDOW_COVER_SETUP_SEC = 10;

/**
 * Przedmiot, którym da się zasłonić okno (zasłona, kurtka, pościel). Nie blokuje wejścia; po zdjęciu
 * wraca do ekwipunku. Schemat nie wstawia domyślnych; brak pola = `DEFAULT_WINDOW_COVER_*`.
 */
export const WindowCoverSchema = z.strictObject({
  blocksSight: z.boolean().optional(),
  lightPass: z.number().min(0).max(1).optional(),
  setupSec: z.number().positive().optional(),
});

export type WindowCover = z.infer<typeof WindowCoverSchema>;
