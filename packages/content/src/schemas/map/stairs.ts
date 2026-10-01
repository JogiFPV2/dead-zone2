import { z } from 'zod';
import { LocalTileSchema } from './address.js';

/** Kierunek wchodzenia biegu schodów: N = ku −y, E = +x, S = +y, W = −x. */
export const STAIR_DIRS = ['N', 'E', 'S', 'W'] as const;
/** Najdłuższy bieg w kaflach. */
export const STAIR_MAX_LEN = 16;

/**
 * Bieg schodów z piętra chunka (`address.z`) na z + 1: dolny kafel (`tx`, `ty`, lokalnie w
 * chunku), `len` kafli (1..16, może wejść w sąsiedni chunk) w kierunku `dir`. Wejście od dołu
 * (krawędź pierwszego kafla od strony przeciwnej do `dir`) albo z góry: kafel
 * (tx, ty) + len × dir na piętrze z + 1 (tam w miejscu biegu zwykle brak podłogi). Z boku nie
 * da się wejść. Kontrakt Symulacji: `SimChunk.stairs` (`packages/protocol`), `world/levels.ts`.
 */
export const StairsSchema = z.strictObject({
  tx: LocalTileSchema,
  ty: LocalTileSchema,
  dir: z.enum(STAIR_DIRS),
  len: z.number().int().min(1).max(STAIR_MAX_LEN),
});

export type StairDir = (typeof STAIR_DIRS)[number];
export type Stairs = z.infer<typeof StairsSchema>;

/** Krok kafla dla kierunku biegu (narzędzia mapy). */
export const STAIR_STEP: Readonly<Record<StairDir, readonly [number, number]>> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
};
