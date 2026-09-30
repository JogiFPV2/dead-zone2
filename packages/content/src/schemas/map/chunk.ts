import { z } from 'zod';
import { ChunkAddressSchema } from './address.js';
import { CHUNK_SIZE } from './constants.js';
import { EdgeSchema } from './edge.js';
import { LayerSchema } from './layer.js';
import { MapObjectSchema } from './map-object.js';
import { PaletteSchema } from './palette.js';
import { RoomsSchema } from './room.js';

/**
 * Plik `maps/<mapId>/chunks/<cx>_<cy>_<z>.json`: statyczna zawartość chunka 32×32.
 * Warstwy po parsowaniu to `Uint16Array[1024]` (indeks `y * 32 + x`):
 * - `floor`, `roof` — wartość przez `palette` (0 = pusto),
 * - `room` — `roomId` z `rooms` (0 = na zewnątrz).
 * Stan dynamiczny (otwarte, rozbite, zabite deskami, zawartość schowków) NIE jest w tym pliku.
 */
export const MapChunkSchema = z
  .strictObject({
    address: ChunkAddressSchema,
    palette: PaletteSchema,
    layers: z.strictObject({
      floor: LayerSchema,
      roof: LayerSchema.optional(),
      room: LayerSchema.optional(),
    }),
    edges: z.array(EdgeSchema).default([]),
    objects: z.array(MapObjectSchema).default([]),
    rooms: RoomsSchema.default({}),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string, ...path: (string | number)[]) =>
      ctx.addIssue({ code: 'custom', message, path });
    const where = (i: number) => `kafel (${i % CHUNK_SIZE}, ${Math.floor(i / CHUNK_SIZE)})`;

    for (const name of ['floor', 'roof'] as const) {
      const layer = c.layers[name];
      const bad = layer ? layer.findIndex((v) => v > c.palette.length) : -1;
      if (layer && bad !== -1) {
        issue(
          `${where(bad)}: wartość ${layer[bad]} poza paletą (${c.palette.length})`,
          'layers',
          name,
        );
      }
    }
    const room = c.layers.room;
    const badRoom = room
      ? room.findIndex((v) => v !== 0 && !Object.hasOwn(c.rooms, String(v)))
      : -1;
    if (room && badRoom !== -1) {
      issue(`${where(badRoom)}: roomId ${room[badRoom]} nie ma wpisu w rooms`, 'layers', 'room');
    }
    if (!room && Object.keys(c.rooms).length > 0) {
      issue('rooms wymaga warstwy layers.room', 'layers', 'room');
    }

    const edges = new Set<string>();
    c.edges.forEach((e, i) => {
      const key = `${e.x},${e.y},${e.side}`;
      if (edges.has(key))
        issue(`krawędź ${e.side} kafla (${e.x}, ${e.y}) podana dwa razy`, 'edges', i);
      edges.add(key);
    });
  });

/** Chunk po parsowaniu (warstwy jako `Uint16Array`). */
export type MapChunk = z.output<typeof MapChunkSchema>;
/** Chunk w JSON (warstwy zakodowane). */
export type MapChunkJson = z.input<typeof MapChunkSchema>;
