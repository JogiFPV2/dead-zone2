import { z } from 'zod';
import { I18nKeySchema } from '../common/index.js';
import { ChunkAddressSchema, chunkKey } from './address.js';
import { CHUNK_SIZE, MAP_FORMAT_VERSION } from './constants.js';

/** `maps/<mapId>/manifest.json`. Id mapy to `<namespace paczki>:<mapId>`. */
export const MapManifestSchema = z
  .strictObject({
    formatVersion: z.literal(MAP_FORMAT_VERSION),
    name: I18nKeySchema.optional(),
    chunkSize: z.literal(CHUNK_SIZE),
    /** Wysokość piętra w jednostkach świata (1 kafel = 1 jednostka = 1 m). */
    floorHeight: z.number().positive().max(100),
    /** Wszystkie chunki mapy; każdy ma plik `chunks/<cx>_<cy>_<z>.json`. */
    chunks: z.array(ChunkAddressSchema).min(1),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.chunks.forEach((a, i) => {
      const key = chunkKey(a);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['chunks', i],
          message: `chunk ${key} podany dwa razy`,
        });
      }
      seen.add(key);
    });
  });

export type MapManifest = z.infer<typeof MapManifestSchema>;
