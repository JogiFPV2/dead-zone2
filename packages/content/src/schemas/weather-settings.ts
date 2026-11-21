import { z } from 'zod';

/**
 * Pogoda i księżyc (protokół 50, docs 9.45). Pogoda świata to czysta funkcja ziarna świata i
 * minuty gry (`weatherAt` w `@deadzone/protocol`): okresy po `spellMinutes` minut gry, każdy z
 * rodzajem losowanym wg pory roku (bezchmurnie, pochmurno, deszcz, burza, mgła, śnieg), z
 * przejściem przez `fadeMinutes`. Wyłączona: stała jasność księżyca i bez wpływu na grę.
 */
export const WeatherSettingsSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    spellMinutes: z.number().int().min(30).max(2880).default(360),
    fadeMinutes: z.number().int().min(1).max(240).default(40),
  })
  .prefault({});

export type WeatherSettings = z.infer<typeof WeatherSettingsSchema>;
