import { z } from 'zod';
import { TileRefSchema } from '../common/index.js';

/**
 * Paleta chunka: wartość `v` w warstwie `floor`/`roof` to `palette[v - 1]`, 0 = pusto.
 * Numeracja jest lokalna dla chunka — nie ma globalnych numerów kafli.
 */
export const PaletteSchema = z
  .array(TileRefSchema)
  .max(4096)
  .refine((p) => new Set(p).size === p.length, 'paleta nie może mieć powtórzonych id');

export type Palette = z.infer<typeof PaletteSchema>;

/** Id contentu dla wartości warstwy; `undefined` dla 0 (pusto) i wartości spoza palety. */
export function paletteId(palette: readonly string[], value: number): string | undefined {
  return value === 0 ? undefined : palette[value - 1];
}

/** Wartość warstwy dla id (dopisuje id do palety, jeśli go nie ma). Dla narzędzi i testów. */
export function paletteValue(palette: string[], id: string): number {
  const i = palette.indexOf(id);
  return i === -1 ? palette.push(id) : i + 1;
}
