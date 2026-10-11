/** zod schemas for the `/v1` API and the DZSV envelope header (docs/backend.md §4–5). */
import { z } from 'zod';
import {
  CHARACTER_JSON_MAX_BYTES,
  CHARACTER_NAME_MAX,
  MAP_MARKER_TEXT_MAX,
  MAP_MARKER_ICONS,
  MAX_MAP_MARKERS,
  MAX_MAP_ROOMS_CHARS,
  SAVE_MARKER_COLORS,
  CLOUD_SAVE_REASONS,
  type CreateCharacterRequest,
  type SaveEnvelopeHeader,
} from './api.js';

const U32 = 0xffff_ffff;
/** UTF-8 byte length of the JSON form (no DOM/Node lib here). */
function utf8Bytes(v: unknown): number {
  const s = JSON.stringify(v) ?? '';
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

const smallJsonObject = z
  .record(z.string(), z.unknown())
  .refine((v) => utf8Bytes(v) <= CHARACTER_JSON_MAX_BYTES, {
    message: `max ${CHARACTER_JSON_MAX_BYTES} bytes`,
  });

export const createCharacterRequestSchema: z.ZodType<CreateCharacterRequest> = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(CHARACTER_NAME_MAX)
    // No control characters (names end up in UI lists and tombstones).
    .regex(/^[^\p{Cc}]+$/u),
  appearance: smallJsonObject.optional(),
  world_settings: smallJsonObject.optional(),
});

export const saveEnvelopeHeaderSchema: z.ZodType<SaveEnvelopeHeader> = z.strictObject({
  formatVersion: z.number().int().min(1).max(U32),
  simVersion: z.string().min(1).max(64),
  world_seed: z.number().int().min(0).max(U32),
  worldgen_version: z.number().int().min(1).max(U32),
  characterId: z.uuid(),
  gameDay: z.number().int().min(0).max(1_000_000),
  reason: z.enum(CLOUD_SAVE_REASONS),
  rawSize: z.number().int().min(2).max(U32),
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * One map marker as saved by the sim: `[id, x, y, icon, color, text, showOnMinimap?, z?]`. The
 * 7th element is written only when false (hidden from the minimap) or when `z` follows; missing
 * = true. The 8th is the floor, written only when not 0 (protocol 22); missing = 0. Older saves
 * keep the 6- or 7-element form.
 */
export const saveMarkerSchema = z.tuple([
  z.number().int().min(0).max(U32),
  z.number().finite(),
  z.number().finite(),
  z.enum(MAP_MARKER_ICONS),
  z.enum(SAVE_MARKER_COLORS),
  // The sim trims to MAP_MARKER_TEXT_MAX code points (emoji = 1) and replaces control chars.
  z
    .string()
    .max(MAP_MARKER_TEXT_MAX * 2)
    .refine((t) => Array.from(t).length <= MAP_MARKER_TEXT_MAX, {
      message: `max ${MAP_MARKER_TEXT_MAX} characters`,
    })
    // eslint-disable-next-line no-control-regex
    .refine((t) => !/[\u0000-\u001f\u007f]/.test(t), { message: 'control characters' }),
  z.boolean().optional(),
  z.number().int().min(-0x8000).max(0x7fff).optional(),
]);

export const saveMarkersSchema = z.array(saveMarkerSchema).max(MAX_MAP_MARKERS);

/**
 * Floor plan rooms as saved by the sim (`PlayerMapSave.rooms`, optional, protocol 22): base64
 * of zigzag varint records (sim `encodeRooms`); the sim's decoder checks the content.
 */
export const saveMapRoomsSchema = z
  .string()
  .max(MAX_MAP_ROOMS_CHARS)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, {
    message: 'not base64',
  });

const GAME_DAY = z.number().int().min(0).max(1_000_000);

/**
 * Mains utilities as saved by the sim in the `items` section (protocol 25, all optional: older
 * saves roll the shutoff days from the world seed on load). `powerOffDay` / `waterOffDay` are
 * absolute game days (0 = never).
 */
export const saveUtilitiesSchema = z.object({
  powered: z.boolean().optional(),
  water: z.boolean().optional(),
  powerOffDay: GAME_DAY.optional(),
  waterOffDay: GAME_DAY.optional(),
});

/**
 * Per-item freezing field in the saved item map (protocol 25): `thawUntil` = absolute game
 * minute a frozen item out of the cold is thawed; written only while thawing.
 */
export const saveItemThawSchema = z.object({
  thawUntil: z.number().int().min(0).max(0xffff_ffff).optional(),
});

/**
 * Building key field in the saved item map (protocol 26): `buildingId` = map-global building id
 * (`SimChunk.roomBuildings`) the key opens; written only on keys.
 */
export const saveItemBuildingSchema = z.object({
  buildingId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
});

/**
 * Wound care fields of a saved wound (protocol 27, survival section `wounds`): `stitched`, and
 * `cleanUntilAge` = wound age (minutes) until which it cannot get a dirt infection after
 * disinfecting. Written only when set; older saves have neither.
 */
export const saveWoundCareSchema = z.object({
  stitched: z.boolean().optional(),
  cleanUntilAge: z.number().int().min(0).max(0xffff_ffff).optional(),
});
