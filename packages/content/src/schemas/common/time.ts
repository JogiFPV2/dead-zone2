import { z } from 'zod';

/** Czas w minutach gry (akcje, crafting, czytanie, psucie się). Maks. 10 lat gry. */
export const GameMinutesSchema = z
  .number()
  .min(0)
  .max(60 * 24 * 365 * 10);

/**
 * Czas w sekundach rzeczywistych — tylko dla tempa walki (ataki, przeładowanie, cooldown),
 * które Symulacja liczy w tickach 20 Hz, niezależnie od długości doby.
 */
export const RealSecondsSchema = z.number().min(0).max(600);
