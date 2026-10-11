import type { Footprint } from '../schemas/common/footprint.js';

/** Mebel bez pola `footprint` (stare zapisy, mapy, mody) zajmuje jeden kafel. */
export const DEFAULT_FOOTPRINT: Readonly<Footprint> = Object.freeze({ w: 1, h: 1 });

/** Pola, z których czyta `footprintOf` (typ schowka, przedmiot `placeable`); inne obiekty = 1×1. */
export interface FootprintSource {
  readonly footprint?: Footprint | undefined;
  readonly placeable?: { readonly footprint?: Footprint | undefined } | undefined;
}

/**
 * Rozmiar mebla przy `rot = 0`: `footprint` typu schowka albo `placeable.footprint` przedmiotu;
 * brak definicji lub pola = 1×1.
 */
export function footprintOf(def: FootprintSource | object | undefined): Footprint {
  const d = def as FootprintSource | undefined;
  const fp = d?.footprint ?? d?.placeable?.footprint ?? DEFAULT_FOOTPRINT;
  return { w: fp.w, h: fp.h };
}
