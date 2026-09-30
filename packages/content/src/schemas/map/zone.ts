import { z } from 'zod';
import { NAMESPACE_PATTERN, TagSchema } from '../common/index.js';

/** Nazwa lokalna (id strefy, rola) w kebab-case, bez namespace, np. `villa`, `start`. */
export const ZoneNameSchema = z
  .string()
  .regex(NAMESPACE_PATTERN, 'nazwa strefy/roli w kebab-case, np. `villa`');

/** Prostokąt w globalnych współrzędnych kafli (`x = cx * 32 + lx`); punkt = 1×1. */
export const ZoneRectSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

/**
 * Strefa mapy (w manifeście): suma prostokątów na piętrze `z`. `id` jest unikalne w mapie,
 * `role` może się powtarzać (np. kilka stref `extraction`). Granice i puste strefy sprawdza walidator.
 */
export const MapZoneSchema = z.strictObject({
  id: ZoneNameSchema,
  role: ZoneNameSchema,
  z: z.number().int(),
  rects: z.array(ZoneRectSchema),
  tags: z.array(TagSchema).optional(),
});

export type ZoneRect = z.infer<typeof ZoneRectSchema>;
export type MapZone = z.infer<typeof MapZoneSchema>;
