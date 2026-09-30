/**
 * `@deadzone/protocol/schema`: zod schemas and validators for untrusted input at host boundaries
 * (sim worker, server). Kept out of the main entry so the game's main-thread bundle has no zod.
 */
import { z } from 'zod';
import {
  MAX_PLAYER_ID,
  MAX_WORLD_COORD,
  U32_MAX,
  type Command,
  type CommandParseResult,
} from './commands.js';
import { CHUNK_TILES } from './map.js';
import type { MainToWorker, ParseResult } from './worker-messages.js';

const header = {
  tick: z.number().int().min(0).max(U32_MAX),
  playerId: z.number().int().min(0).max(MAX_PLAYER_ID),
  seq: z.number().int().min(0).max(U32_MAX),
};

const axis = z.number().finite().min(-1).max(1);
const coord = z.number().finite().min(-MAX_WORLD_COORD).max(MAX_WORLD_COORD);

export const moveCommandSchema = z.strictObject({
  ...header,
  type: z.literal('move'),
  dx: axis,
  dy: axis,
});

export const aimCommandSchema = z.strictObject({
  ...header,
  type: z.literal('aim'),
  x: coord,
  y: coord,
});

/** Structural validation at the host boundary (worker, server). Gameplay checks live in sim. */
export const commandSchema = z.discriminatedUnion('type', [moveCommandSchema, aimCommandSchema]);

/** Validates untrusted input; never throws. */
export function parseCommand(input: unknown): CommandParseResult {
  const r = commandSchema.safeParse(input);
  if (r.success) return { ok: true, command: r.data };
  return { ok: false, error: z.prettifyError(r.error) };
}

export const isCommand = (input: unknown): input is Command =>
  commandSchema.safeParse(input).success;

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

export const simSpawnSchema = z.strictObject({ x: coord, y: coord, z: chunkInt });

export const mainToWorkerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('init'),
    seed: z.number().int(),
    map: simMapDataSchema,
    spawn: simSpawnSchema.optional(),
  }),
  z.object({ kind: z.literal('cmd'), cmd: commandSchema }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('speed'), x: z.union([z.literal(1), z.literal(2), z.literal(4)]) }),
  z.object({ kind: z.literal('release'), buf: z.instanceof(ArrayBuffer) }),
]);

/** Validates a message received by the worker; never throws. */
export function parseMainToWorker(input: unknown): ParseResult<MainToWorker> {
  const r = mainToWorkerSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: z.prettifyError(r.error) };
}
