import { z } from 'zod';

/**
 * Pomocniki ustawień przetrwania. Każde pole ma wartość domyślną, więc każdy plik
 * `world-settings*.json` (baza i mody) waliduje się samodzielnie, a mod może zmienić jedno pole.
 * Tempa są w punktach statystyki (0–100) na minutę gry, chyba że nazwa mówi inaczej.
 */

/** Nieujemna liczba z domyślną wartością. */
export const num = (value: number, max = 10000) => z.number().min(0).max(max).default(value);

/** Ułamek 0..1 z domyślną wartością. */
export const frac = (value: number) => z.number().min(0).max(1).default(value);

/** Mnożnik (1 = bez zmian) z domyślną wartością. */
export const mul = (value: number) => z.number().min(0).max(20).default(value);

/** Próg w skali statystyki 0–100. */
export const stat = (value: number) => z.number().min(0).max(100).default(value);

/** Temperatura w °C. */
export const celsius = (value: number) => z.number().min(-60).max(80).default(value);

/** Czas w minutach gry. */
export const minutes = (value: number) =>
  z
    .number()
    .min(0)
    .max(60 * 24 * 365)
    .default(value);

/** Przedział minut gry {min, max} z domyślnymi wartościami. */
export const minuteRange = (min: number, max: number) =>
  z
    .strictObject({ min: minutes(min), max: minutes(max) })
    .refine((r) => r.min <= r.max, { message: 'min nie może być większe niż max', path: ['max'] })
    .prefault({});
