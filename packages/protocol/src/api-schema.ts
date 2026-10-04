/** zod schemas for the `/v1` API and the DZSV envelope header (docs/backend.md §4–5). */
import { z } from 'zod';
import {
  CHARACTER_JSON_MAX_BYTES,
  CHARACTER_NAME_MAX,
  MAP_MARKER_TEXT_MAX,
  MAP_MARKER_ICONS,
  MAX_MAP_MARKERS,
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
 * One map marker as saved by the sim: `[id, x, y, icon, color, text, showOnMinimap?]`. The 7th
 * element is written only when false (hidden from the minimap); missing = true, so older saves
 * and markers shown on the minimap keep the 6-element form.
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
]);

export const saveMarkersSchema = z.array(saveMarkerSchema).max(MAX_MAP_MARKERS);
