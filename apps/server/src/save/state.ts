import {
  EXPLORED_BITMAP_BYTES,
  MAP_CHUNKS,
  MAP_SIZE_M,
  PLAYER_MAP_TRAIL_MAX_POINTS,
  PLAYER_MAP_TRAIL_SPACING_M,
} from '@deadzone/protocol';
import {
  MAX_INTEREST_RADIUS_CHUNKS,
  saveItemBuildingSchema,
  saveItemBurntSchema,
  saveItemThawSchema,
  saveMapRoomsSchema,
  saveMarkersSchema,
  saveUtilitiesSchema,
  saveWaterTanksRawSchema,
} from '@deadzone/protocol/schema';
import { SAVE_FORMAT, SAVE_READABLE_VERSIONS, decodeTrail, zeroRleStats } from '@deadzone/sim';
import { z } from 'zod';
import { invalidState } from '../errors.js';

/**
 * Server checks of the sim save inside a DZSV envelope (`saveWorld` in packages/sim/src/save,
 * format v1–v3; docs/backend.md §4.2). The map limits come from `packages/protocol`, the codecs
 * (zero-run varints, trail) from `packages/sim`. Opaque sim sections (components, survival, AI,
 * vehicles, openings, physics) are only bounded by the state size: a full `loadWorld` needs the
 * content and the world generator on the server.
 */

/** Map edge in metres (16 × 16 km = 512 × 512 chunks of 32 m). */
export const WORLD_METRES = MAP_SIZE_M;
const WORLD_CHUNKS = MAP_CHUNKS * MAP_CHUNKS;
/** Entity capacity cap of a save (sim `maxEntities`). */
const MAX_CAPACITY = 1 << 20;
/** Characters (players) in one save: singleplayer now, small co-op later. */
const MAX_PLAYERS = 16;
/** Trail: two zigzag varints per point, at most 5 bytes each, base64. */
const MAX_TRAIL_CHARS = 4 * Math.ceil((PLAYER_MAP_TRAIL_MAX_POINTS * 10) / 3);

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const base64 = z.string().regex(BASE64, { message: 'not base64' });
const int = z.number().int();
const nat = int.min(0);
const rngState = z.tuple([int, int, int, int]);
const coordinate = z.number().finite().min(0).max(WORLD_METRES);

/** Zero-run varint field (`encodeZeroRle`): bounded decoded length and value range. */
function rle(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  s: string,
  o: { exact?: number; max: number; maxValue: number },
): void {
  try {
    const st = zeroRleStats(s, o.exact ?? o.max);
    if (o.exact !== undefined && st.length !== o.exact) {
      ctx.addIssue({ code: 'custom', path, message: `length ${st.length}, expected ${o.exact}` });
    }
    if (st.max > o.maxValue) ctx.addIssue({ code: 'custom', path, message: 'value too large' });
  } catch (e) {
    ctx.addIssue({ code: 'custom', path, message: e instanceof Error ? e.message : 'bad delta' });
  }
}

/**
 * One character map (`PlayerMapSave`, map/player-map.ts). Markers may carry the optional 8th
 * element `z` (floor, protocol 22; `saveMarkerSchema`). `rooms` (floor plan rooms, protocol 22) is
 * optional: base64 within `MAX_MAP_ROOMS_CHARS`; the sim decoder checks the records on load.
 */
const playerMapSchema = z
  .looseObject({
    sid: nat,
    discovered: base64,
    trail: base64.max(MAX_TRAIL_CHARS),
    markers: saveMarkersSchema,
    nextId: int.min(1),
    rooms: saveMapRoomsSchema.optional(),
  })
  .superRefine((m, ctx) => {
    rle(ctx, ['discovered'], m.discovered, { max: EXPLORED_BITMAP_BYTES, maxValue: 0xff });
    const ids = new Set<number>();
    m.markers.forEach(([id, x, y], i) => {
      if (!coordinate.safeParse(x).success || !coordinate.safeParse(y).success) {
        ctx.addIssue({ code: 'custom', path: ['markers', i], message: 'marker outside the map' });
      }
      if (ids.has(id) || id >= m.nextId) {
        ctx.addIssue({ code: 'custom', path: ['markers', i], message: 'bad marker id' });
      }
      ids.add(id);
    });
    let pts: number[];
    try {
      pts = decodeTrail(m.trail);
    } catch {
      ctx.addIssue({ code: 'custom', path: ['trail'], message: 'truncated trail' });
      return;
    }
    if (pts.length / 2 > PLAYER_MAP_TRAIL_MAX_POINTS) {
      ctx.addIssue({ code: 'custom', path: ['trail'], message: 'too many trail points' });
      return;
    }
    const min2 = PLAYER_MAP_TRAIL_SPACING_M * PLAYER_MAP_TRAIL_SPACING_M;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i]!;
      const y = pts[i + 1]!;
      if (x < 0 || y < 0 || x > WORLD_METRES || y > WORLD_METRES) {
        ctx.addIssue({ code: 'custom', path: ['trail'], message: 'trail outside the map' });
        return;
      }
      if (i > 0) {
        const dx = x - pts[i - 2]!;
        const dy = y - pts[i - 1]!;
        if (dx * dx + dy * dy < min2) {
          ctx.addIssue({ code: 'custom', path: ['trail'], message: 'trail points too dense' });
          return;
        }
      }
    }
  });

/** World delta of the LOD (`LodSave`, save/delta.ts, #104). */
const lodSchema = z
  .looseObject({
    cellsW: int.min(1).max(MAP_CHUNKS),
    cellsH: int.min(1).max(MAP_CHUNKS),
    types: int.min(1).max(64),
    counts: base64,
    active: base64,
    epoch: base64,
    chunks: base64,
    sig: z.array(z.tuple([nat.max(WORLD_CHUNKS - 1), int])).max(WORLD_CHUNKS),
    cellRng: z.array(z.tuple([nat, rngState])).max(WORLD_CHUNKS),
    damaged: z.array(z.tuple([nat, z.array(int).max(4096)])).max(WORLD_CHUNKS),
    lures: z.array(z.tuple([nat, z.array(z.number()).max(4096)])).max(WORLD_CHUNKS),
    noises: z.array(z.array(z.number()).max(64)).max(4096),
    stairs: z
      .array(nat.max(WORLD_CHUNKS - 1))
      .max(WORLD_CHUNKS)
      .optional(),
    // Counters off the ground and stair masks of split cells (sim docs 9.39; absent = none).
    floors: z
      .array(z.tuple([nat, z.array(nat.max(0xffff)).max(64 * 256)]))
      .max(WORLD_CHUNKS)
      .optional(),
    links: z
      .array(z.tuple([nat, nat.max(0xffff_ffff)]))
      .max(WORLD_CHUNKS)
      .optional(),
    cursor: nat,
    rng: rngState,
  })
  .superRefine((l, ctx) => {
    const cells = l.cellsW * l.cellsH;
    rle(ctx, ['counts'], l.counts, { exact: cells * l.types, max: 0, maxValue: 0xffff });
    rle(ctx, ['active'], l.active, { exact: cells, max: 0, maxValue: 0xff });
    rle(ctx, ['epoch'], l.epoch, { exact: cells, max: 0, maxValue: 0xffff });
    rle(ctx, ['chunks'], l.chunks, { max: WORLD_CHUNKS, maxValue: 0xff });
    l.floors?.forEach(([cell, v], i) => {
      if (cell >= cells || v.length === 0 || v.length % l.types !== 0)
        ctx.addIssue({ code: 'custom', path: ['floors', i], message: 'bad floor counters' });
    });
    l.links?.forEach(([cell], i) => {
      if (cell >= cells)
        ctx.addIssue({ code: 'custom', path: ['links', i], message: 'cell outside the grid' });
    });
  });

/**
 * One saved item (`ItemInstance`, items/store.ts) in the item store map (`{ $m: [[id, item]] }`).
 * Only the optional fields are checked; the rest stays opaque like the other sim sections.
 * `wear` (improvised weapon wear, protocol 21) is a non-negative number, absent = 0.
 */
const savedItemSchema = z.looseObject({
  wear: z.number().finite().min(0).optional(),
  fuelL: z.number().finite().min(0).optional(),
  vehicle: nat.optional(),
  // Protocol 25: thawing frozen food; protocol 26: building keys (`@deadzone/protocol/schema`).
  ...saveItemThawSchema.shape,
  ...saveItemBuildingSchema.shape,
  // Protocol 31: burnt cooked food (written only when true).
  ...saveItemBurntSchema.shape,
});

/**
 * Item store section (`items` of the save): loose, with the item map and the mains utilities
 * (protocol 25, `saveUtilitiesSchema`) checked when present. Wound care (protocol 27,
 * `saveWoundCareSchema`), sleep alarms and dirt (protocols 29/33) live in the opaque `survival`
 * section and lighting (protocol 32, `saveLightingSchema`) in the opaque `openings` section; none
 * of them is checked here. Furniture water tanks (protocol 36, `saveWaterTanksRawSchema`) are checked;
 * the action `fixture` (protocol 36) lives in the opaque `queue` section.
 */
const itemsSectionSchema = z.looseObject({
  ...saveUtilitiesSchema.shape,
  // Protocol 36: furniture water tanks that are not full, as on disk (`{ $m: [[key, litres], …] }`).
  ...saveWaterTanksRawSchema.shape,
  items: z
    .looseObject({ $m: z.array(z.tuple([nat, savedItemSchema])).max(MAX_CAPACITY) })
    .optional(),
});

const stateSchema = z.looseObject({
  format: z.literal(SAVE_FORMAT),
  version: int.refine((v) => SAVE_READABLE_VERSIONS.includes(v), {
    message: 'unreadable save version',
  }),
  protocol: int.min(1).optional(),
  seed: nat.max(0xffff_ffff),
  capacity: int.min(1).max(MAX_CAPACITY).optional(),
  fingerprint: z.string().max(256).optional(),
  tick: nat,
  nextStableId: nat.optional(),
  players: z
    .array(z.tuple([nat, nat]))
    .max(MAX_PLAYERS)
    .optional(),
  entities: z
    .array(z.tuple([nat, z.array(z.string().max(64)).max(256)]))
    .max(MAX_CAPACITY)
    .optional(),
  components: z.record(z.string(), z.unknown()).optional(),
  items: itemsSectionSchema.optional(),
  rng: z.record(z.string(), rngState).optional(),
  world: z
    .looseObject({ seed: nat, generatorVersion: nat, contentVersion: z.string().max(256) })
    .optional(),
  lod: lodSchema.optional(),
  freeEids: z.array(nat).max(MAX_CAPACITY).optional(),
  playerMaps: z.array(playerMapSchema).max(MAX_PLAYERS).optional(),
  interest: z
    .array(z.tuple([nat, int, int, nat.max(MAX_INTEREST_RADIUS_CHUNKS)]))
    .max(MAX_PLAYERS)
    .optional(),
});

export type SaveState = z.infer<typeof stateSchema>;

/**
 * Validates the sim state; `formatVersion` and `worldSeed` come from the envelope header (the
 * sim seed is the character's `world_seed`).
 */
export function validateState(state: unknown, formatVersion: number, worldSeed: number): SaveState {
  const r = stateSchema.safeParse(state);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw invalidState(`state: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'invalid'}`);
  }
  if (r.data.version !== formatVersion) throw invalidState('state version does not match header');
  if (r.data.seed !== worldSeed) throw invalidState('state seed does not match the character');
  return r.data;
}
