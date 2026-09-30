import { z } from 'zod';
import { RoomTypeSchema } from '../common/index.js';

/** `roomId` w JSON: dodatnia liczba całkowita jako klucz (wartość warstwy `room`). */
export const RoomIdSchema = z.string().regex(/^[1-9]\d{0,4}$/, 'roomId: liczba 1..65535');

/**
 * Pomieszczenie. `roomType` (np. `base:room-kitchen`) wybiera loot tables, które mają go w `rooms`.
 * `buildingId` grupuje pomieszczenia w budynek (render ukrywa dach i ściany budynku).
 * Oba id są wspólne dla całej mapy: ten sam `roomId` w kilku chunkach to jedno pomieszczenie.
 */
export const RoomSchema = z.strictObject({
  roomType: RoomTypeSchema,
  buildingId: z.number().int().min(1).max(0xffff),
});

export const RoomsSchema = z.record(RoomIdSchema, RoomSchema);

export type Room = z.infer<typeof RoomSchema>;
