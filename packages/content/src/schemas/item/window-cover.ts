import { z } from 'zod';

/** Domyślny czas zawieszenia przedmiotu na oknie (sekundy gry). */
export const DEFAULT_WINDOW_COVER_SETUP_SEC = 10;

/**
 * Przedmiot, którym da się zasłonić okno (zasłona, kurtka, pościel). Blokuje wzrok i światło,
 * nie wejście; po zdjęciu wraca do ekwipunku. Schemat nie wstawia domyślnych:
 * brak `setupSec` = `DEFAULT_WINDOW_COVER_SETUP_SEC`.
 */
export const WindowCoverSchema = z.strictObject({
  setupSec: z.number().positive().optional(),
});

export type WindowCover = z.infer<typeof WindowCoverSchema>;
