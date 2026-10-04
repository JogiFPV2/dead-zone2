import { CHUNK_SIZE_M, EXPLORED_BITMAP_BYTES, MAP_CHUNKS } from '@deadzone/protocol';
import { saveMarkersSchema } from '@deadzone/protocol/schema';
import { z } from 'zod';
import { invalidState } from '../errors.js';

/** Map edge in metres from the shared constants (16 × 16 km = 512 × 512 chunks of 32 m). */
export const WORLD_METRES = MAP_CHUNKS * CHUNK_SIZE_M;
/** base64 length of `n` bytes. */
const b64Len = (n: number): number => 4 * Math.ceil(n / 3);
/** Explored bitmap MAP_CHUNKS² bits (512×512 = 32 KiB raw); the sim folds zero runs, which never grows it 2×. */
const MAX_DISCOVERED_CHARS = b64Len(EXPLORED_BITMAP_BYTES * 2);
/** Trail: point every 16 m, at most 20 000 points, ≤ 2 varints of 5 bytes each. */
export const MAX_TRAIL_POINTS = 20_000;
const MAX_TRAIL_CHARS = b64Len(MAX_TRAIL_POINTS * 10);
/** Changed chunks only: at most every chunk of the map. */
export const MAX_CHANGED_CHUNKS = MAP_CHUNKS * MAP_CHUNKS;

const coordinate = z.number().finite().min(0).max(WORLD_METRES);

/** One character map in the sim save (`PlayerMapSave`, docs/backend.md §4.2). */
const playerMapSchema = z.looseObject({
  sid: z.number().int().min(0),
  discovered: z.string().max(MAX_DISCOVERED_CHARS),
  trail: z.string().max(MAX_TRAIL_CHARS),
  markers: saveMarkersSchema.refine(
    (ms) =>
      ms.every((m) => coordinate.safeParse(m[1]).success && coordinate.safeParse(m[2]).success),
    {
      message: 'marker outside the map',
    },
  ),
  nextId: z.number().int().min(0),
});

/**
 * Structural checks of the sim save inside the envelope (packages/sim/src/save/save.ts). Unknown
 * sections pass: the full `deserializeState` check in a worker comes with the sim save API.
 */
const stateSchema = z.looseObject({
  format: z.literal('deadzone-save'),
  version: z.number().int().min(1),
  seed: z.number().int(),
  tick: z.number().int().min(0),
  playerMaps: z.array(playerMapSchema).max(8).optional(),
  changedChunks: z.array(z.unknown()).max(MAX_CHANGED_CHUNKS).optional(),
});

export type SaveState = z.infer<typeof stateSchema>;

export function validateState(state: unknown, formatVersion: number): SaveState {
  const r = stateSchema.safeParse(state);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw invalidState(`state: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'invalid'}`);
  }
  if (r.data.version !== formatVersion) throw invalidState('state version does not match header');
  return r.data;
}
