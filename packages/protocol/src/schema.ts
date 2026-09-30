/**
 * `@deadzone/protocol/schema`: zod schemas and validators for untrusted input at host boundaries
 * (sim worker, server). Kept out of the main entry so the game's main-thread bundle has no zod.
 */
import { z } from 'zod';
import {
  BODY_PARTS,
  DEBUG_STATS,
  EQUIP_SLOTS,
  GAITS,
  MAX_PLAYER_ID,
  MAX_WORLD_COORD,
  U32_MAX,
  WOUND_KINDS,
  type Command,
  type CommandParseResult,
} from './commands.js';
import { CHUNK_SIZE, CHUNK_TILES, SIM_EDGE_KINDS } from './map.js';
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
  gait: z.enum(GAITS).optional(),
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

const u32 = z.number().int().min(0).max(U32_MAX);
const itemId = u32;
const containerId = u32;
const count = z.number().int().min(1).max(100_000).optional();
const tileCoord = z.number().int().min(-MAX_WORLD_COORD).max(MAX_WORLD_COORD);

export const pickUpCommandSchema = z.strictObject({
  ...header,
  type: z.literal('pickUp'),
  item: itemId,
  count,
});
export const dropCommandSchema = z.strictObject({
  ...header,
  type: z.literal('drop'),
  item: itemId,
  count,
});
export const moveItemCommandSchema = z.strictObject({
  ...header,
  type: z.literal('moveItem'),
  item: itemId,
  to: containerId,
  count,
});
export const equipCommandSchema = z.strictObject({
  ...header,
  type: z.literal('equip'),
  item: itemId,
  slot: z.enum(EQUIP_SLOTS),
});
export const unequipCommandSchema = z.strictObject({
  ...header,
  type: z.literal('unequip'),
  slot: z.enum(EQUIP_SLOTS),
});
export const openContainerCommandSchema = z.strictObject({
  ...header,
  type: z.literal('openContainer'),
  container: containerId,
});
export const closeContainerCommandSchema = z.strictObject({
  ...header,
  type: z.literal('closeContainer'),
});
export const useItemCommandSchema = z.strictObject({
  ...header,
  type: z.literal('useItem'),
  item: itemId,
  part: bodyPart.optional(),
});
export const cancelActionCommandSchema = z.strictObject({
  ...header,
  type: z.literal('cancelAction'),
});
export const placeStorageCommandSchema = z.strictObject({
  ...header,
  type: z.literal('placeStorage'),
  item: itemId,
  x: tileCoord,
  y: tileCoord,
});
export const pickUpStorageCommandSchema = z.strictObject({
  ...header,
  type: z.literal('pickUpStorage'),
  container: containerId,
});
export const debugGiveItemCommandSchema = z.strictObject({
  ...header,
  type: z.literal('debugGiveItem'),
  itemId: contentId,
  count: z.number().int().min(1).max(1000).optional(),
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

export const debugSpawnZombieCommandSchema = z.strictObject({
  ...header,
  type: z.literal('debugSpawnZombie'),
  x: coord,
  y: coord,
  z: z.number().int().min(-0x8000).max(0x7fff).optional(),
  count: z.number().int().min(1).max(500).optional(),
  zombieType: contentId.optional(),
});

export const debugNoiseCommandSchema = z.strictObject({
  ...header,
  type: z.literal('debugNoise'),
  x: coord,
  y: coord,
  z: z.number().int().min(-0x8000).max(0x7fff).optional(),
  radiusTiles: z.number().finite().min(0).max(500),
  volume: z.number().finite().min(0).max(1).optional(),
});

/** Structural validation at the host boundary (worker, server). Gameplay checks live in sim. */
export const commandSchema = z.discriminatedUnion('type', [
  moveCommandSchema,
  aimCommandSchema,
  sleepCommandSchema,
  wakeCommandSchema,
  bandageCommandSchema,
  pickUpCommandSchema,
  dropCommandSchema,
  moveItemCommandSchema,
  equipCommandSchema,
  unequipCommandSchema,
  openContainerCommandSchema,
  closeContainerCommandSchema,
  useItemCommandSchema,
  cancelActionCommandSchema,
  placeStorageCommandSchema,
  pickUpStorageCommandSchema,
  debugWoundCommandSchema,
  debugStatCommandSchema,
  debugGiveItemCommandSchema,
  debugSpawnZombieCommandSchema,
  debugNoiseCommandSchema,
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

const localTile = z
  .number()
  .int()
  .min(0)
  .max(CHUNK_SIZE - 1);

export const simMapDataSchema = z.object({
  chunks: z.array(
    z.object({
      cx: chunkInt,
      cy: chunkInt,
      z: chunkInt,
      floor: layer,
      edgeN: layer,
      edgeW: layer,
      room: layer.optional(),
      rooms: z.record(z.string().regex(/^[1-9]\d{0,4}$/), contentId).optional(),
      objects: z
        .array(z.object({ contentId, x: localTile, y: localTile }))
        .max(CHUNK_TILES * 4)
        .optional(),
    }),
  ),
  zones: z
    .array(
      z.object({
        id: z.string().max(128),
        role: z.string().max(128),
        z: chunkInt,
        rects: z
          .array(
            z.object({
              x: z.number().int(),
              y: z.number().int(),
              w: z.number().int().min(1),
              h: z.number().int().min(1),
            }),
          )
          .max(4096),
        tags: z.array(z.string().max(128)).max(64).optional(),
      }),
    )
    .max(4096)
    .optional(),
  edgeKinds: z.array(z.enum(SIM_EDGE_KINDS).nullable()).max(0x10000).optional(),
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
    zombies: z
      .array(
        z.strictObject({
          x: coord,
          y: coord,
          z: chunkInt.optional(),
          type: contentId.optional(),
        }),
      )
      .max(5000)
      .optional(),
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
