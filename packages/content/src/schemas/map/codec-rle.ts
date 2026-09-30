import { CHUNK_TILES } from './constants.js';

/** Odcinek RLE: `[wartość, liczba powtórzeń]`. */
export type RleRun = [value: number, count: number];

/** Koduje warstwę jako RLE (kolejne odcinki tej samej wartości). Czysta funkcja. */
export function encodeRle(values: ArrayLike<number>): RleRun[] {
  const runs: RleRun[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const last = runs[runs.length - 1];
    if (last && last[0] === v) last[1]++;
    else runs.push([v, 1]);
  }
  return runs;
}

/**
 * Dekoduje RLE do `Uint16Array`. Rzuca `RangeError`, gdy wartość nie jest uint16,
 * liczba powtórzeń nie jest dodatnia albo suma długości ≠ `length` (domyślnie 1024).
 */
export function decodeRle(runs: readonly (readonly [number, number])[], length = CHUNK_TILES) {
  let total = 0;
  for (const [v, c] of runs) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
      throw new RangeError(`RLE: wartość ${v} nie jest uint16`);
    }
    if (!Number.isInteger(c) || c < 1) throw new RangeError(`RLE: liczba powtórzeń ${c} < 1`);
    total += c;
  }
  if (total !== length) {
    throw new RangeError(`RLE daje ${total} wartości, oczekiwano ${length}`);
  }
  const out = new Uint16Array(length);
  let i = 0;
  for (const [v, c] of runs) {
    out.fill(v, i, i + c);
    i += c;
  }
  return out;
}
