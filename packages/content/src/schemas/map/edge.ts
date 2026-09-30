import { z } from 'zod';
import { TileRefSchema } from '../common/index.js';
import { LocalTileSchema } from './address.js';

export const EDGE_TYPES = ['wall', 'window', 'door'] as const;

/**
 * Krawędź kafla (rzadka lista, tylko istniejące krawędzie). Każdy kafel ma własne krawędzie
 * `n` (między `y` a `y-1`) i `w` (między `x` a `x-1`); krawędź południowa/wschodnia to `n`/`w`
 * sąsiedniego kafla, na granicy chunka — kafla w sąsiednim chunku. `contentId` wskazuje `tiles/`
 * z `category` równym `type`. Stan (otwarte, rozbite, zabite deskami) jest poza chunkiem.
 */
export const EdgeSchema = z.strictObject({
  x: LocalTileSchema,
  y: LocalTileSchema,
  side: z.enum(['n', 'w']),
  type: z.enum(EDGE_TYPES),
  contentId: TileRefSchema,
});

export type EdgeType = (typeof EDGE_TYPES)[number];
export type Edge = z.infer<typeof EdgeSchema>;
