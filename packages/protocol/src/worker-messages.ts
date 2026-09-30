import { z } from 'zod';
import { commandSchema, type Command } from './commands.js';
import { CHUNK_TILES, type SimMapData } from './map.js';

export type SimSpeed = 1 | 2 | 4;

/** Main thread → sim worker. */
export type MainToWorker =
  | { kind: 'init'; seed: number; map: SimMapData }
  | { kind: 'cmd'; cmd: Command }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'speed'; x: SimSpeed }
  /** Gives a snapshot buffer back to the worker pool once render no longer needs it. */
  | { kind: 'release'; buf: ArrayBuffer };

/** Sim worker → main thread. `buf` is transferred (zero-copy), see snapshot.ts for the layout. */
export type WorkerToMain =
  { kind: 'ready'; tick: number } | { kind: 'snapshot'; tick: number; buf: ArrayBuffer };

const layer = z.custom<Uint16Array>(
  (v) => v instanceof Uint16Array && v.length === CHUNK_TILES,
  `expected Uint16Array(${CHUNK_TILES})`,
);
const chunkInt = z.number().int().min(-0x8000).max(0x7fff);

export const simMapDataSchema = z.object({
  chunks: z.array(
    z.object({ cx: chunkInt, cy: chunkInt, z: chunkInt, floor: layer, edgeN: layer, edgeW: layer }),
  ),
});

export const mainToWorkerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('init'), seed: z.number().int(), map: simMapDataSchema }),
  z.object({ kind: z.literal('cmd'), cmd: commandSchema }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('speed'), x: z.union([z.literal(1), z.literal(2), z.literal(4)]) }),
  z.object({ kind: z.literal('release'), buf: z.instanceof(ArrayBuffer) }),
]);

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates a message received by the worker; never throws. */
export function parseMainToWorker(input: unknown): ParseResult<MainToWorker> {
  const r = mainToWorkerSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: z.prettifyError(r.error) };
}
