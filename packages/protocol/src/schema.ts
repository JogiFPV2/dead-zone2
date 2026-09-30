/**
 * `@deadzone/protocol/schema`: zod schemas and validators for untrusted input at host boundaries
 * (sim worker, server). Kept out of the main entry so the game's main-thread bundle has no zod.
 */
import { z } from 'zod';
import {
  BODY_PARTS,
  DEBUG_STATS,
  MAX_PLAYER_ID,
  MAX_WORLD_COORD,
  U32_MAX,
  WOUND_KINDS,
  type Command,
  type CommandParseResult,
} from './commands.js';
import { CHUNK_TILES } from './map.js';
import type { MainToWorker, ParseResult, SimContentFile } from './worker-messages.js';

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

const bodyPart = z.enum(BODY_PARTS);
/** Content id (`namespace:kebab-name`), same shape as in packages/content. */
const contentId = z
  .string()
  .max(128)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/);

export const sleepCommandSchema = z.strictObject({ ...header, type: z.literal('sleep') });
export const wakeCommandSchema = z.strictObject({ ...header, type: z.literal('wake') });

export const bandageCommandSchema = z.strictObject({
  ...header,
  type: z.literal('bandage'),
  part: bodyPart,
  itemId: contentId.optional(),
});

export const debugWoundCommandSchema = z.strictObject({
  ...header,
  type: z.literal('debugWound'),
  part: bodyPart,
  wound: z.enum(WOUND_KINDS),
  zombie: z.boolean().optional(),
});

export const debugStatCommandSchema = z.strictObject({
  ...header,
  type: z.literal('debugStat'),
  stat: z.enum(DEBUG_STATS),
  value: z.number().finite().min(-100).max(1000),
});

/** Structural validation at the host boundary (worker, server). Gameplay checks live in sim. */
export const commandSchema = z.discriminatedUnion('type', [
  moveCommandSchema,
  aimCommandSchema,
  sleepCommandSchema,
  wakeCommandSchema,
  bandageCommandSchema,
  debugWoundCommandSchema,
  debugStatCommandSchema,
]);

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Shape only: `{ path, json }` or `{ path, text }`; the content validator checks the rest. */
const contentFile = z.custom<SimContentFile>(
  (v) =>
    isRecord(v) &&
    typeof v.path === 'string' &&
    (('json' in v && !('text' in v)) || (typeof v.text === 'string' && !('json' in v))),
  'expected { path, json } or { path, text }',
);

export const simContentSourceSchema = z.object({
  packs: z
    .array(z.object({ dir: z.string().max(256), files: z.array(contentFile).max(20000) }))
    .max(256),
});

export const mainToWorkerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('init'),
    seed: z.number().int(),
    map: simMapDataSchema,
    spawn: simSpawnSchema.optional(),
    content: simContentSourceSchema.optional(),
    dev: z.boolean().optional(),
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
