import { z } from 'zod';
import { CHUNK_SIZE } from './constants.js';

const ChunkCoordSchema = z.number().int().min(-4096).max(4095);

/** Adres chunka: `cx`, `cy` w chunkach, `z` = piętro (0 = parter, ujemne = piwnice). */
export const ChunkAddressSchema = z.strictObject({
  cx: ChunkCoordSchema,
  cy: ChunkCoordSchema,
  z: z.number().int().min(-8).max(31),
});

/** Współrzędna kafla wewnątrz chunka, 0..31. */
export const LocalTileSchema = z
  .number()
  .int()
  .min(0)
  .max(CHUNK_SIZE - 1);

export type ChunkAddress = z.infer<typeof ChunkAddressSchema>;

/** Klucz chunka `cx_cy_z`, np. `0_-1_0`. */
export const chunkKey = (a: ChunkAddress): string => `${a.cx}_${a.cy}_${a.z}`;

/** Nazwa pliku chunka w `maps/<mapId>/chunks/`, np. `0_-1_0.json`. */
export const chunkFileName = (a: ChunkAddress): string => `${chunkKey(a)}.json`;
