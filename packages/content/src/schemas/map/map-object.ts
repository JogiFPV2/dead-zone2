import { z } from 'zod';
import { ContentIdSchema } from '../common/index.js';
import { LocalTileSchema } from './address.js';

/**
 * Obiekt na mapie (mebel, schowek, lampa): `contentId` to typ schowka (`containers/`) albo
 * przedmiot `placeable`. Światłem jest obiekt, którego definicja ma blok `light`.
 * Zawartość schowków i inny stan dynamiczny są poza chunkiem.
 */
export const MapObjectSchema = z.strictObject({
  contentId: ContentIdSchema.describe('ref:mapObject'),
  x: LocalTileSchema,
  y: LocalTileSchema,
  /** Obrót co 90°: 0 = domyślny, 1 = 90°, 2 = 180°, 3 = 270°. */
  rot: z.number().int().min(0).max(3).default(0),
  /** Przesunięcie względem środka kafla, w kaflach. */
  offset: z
    .strictObject({ x: z.number().min(-0.5).max(0.5), y: z.number().min(-0.5).max(0.5) })
    .optional(),
});

export type MapObject = z.infer<typeof MapObjectSchema>;
