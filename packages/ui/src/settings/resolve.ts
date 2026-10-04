import type { z } from 'zod';
import { sanitizeHudLayout } from '../hud-layout/sanitize.js';
import {
  PLAYER_SETTINGS_MAX_BYTES,
  PLAYER_SETTINGS_SECTIONS,
  PLAYER_SETTINGS_VERSION,
  bindingsSchema,
  playerSettingsSchema,
  type PlayerSettings,
} from './player-settings.js';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};

/** Each field of `schema` from `raw`, or its default when missing / invalid. */
function lenientObject<S extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
  raw: unknown,
): z.output<z.ZodObject<S>> {
  const r = obj(raw);
  const out: Obj = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    const p = field.safeParse(r[key]);
    out[key] = p.success ? p.data : field.parse(undefined);
  }
  return out as z.output<z.ZodObject<S>>;
}

/** Bindings entry by entry: invalid actions are dropped (the client fills its defaults). */
function lenientBindings(raw: unknown): PlayerSettings['input']['bindings'] {
  const out: Record<string, string[]> = {};
  for (const [action, codes] of Object.entries(obj(raw))) {
    const p = bindingsSchema.safeParse({ ...out, [action]: codes });
    if (p.success) out[action] = p.data[action] ?? [];
  }
  return out;
}

/** Fresh default settings. */
export function defaultPlayerSettings(): PlayerSettings {
  return playerSettingsSchema.parse({});
}

/**
 * Untrusted saved settings (local or cloud) → valid settings, never throws. Not an object or
 * another version → defaults; an invalid field → its default; unknown keys are dropped.
 */
export function resolveSettings(saved?: unknown): PlayerSettings {
  const r = obj(saved);
  if (r.version !== undefined && r.version !== PLAYER_SETTINGS_VERSION) {
    return defaultPlayerSettings();
  }
  const S = PLAYER_SETTINGS_SECTIONS;
  return {
    version: PLAYER_SETTINGS_VERSION,
    input: { bindings: lenientBindings(obj(r.input).bindings) },
    interface: lenientObject(S.interface, r.interface),
    view: lenientObject(S.view, r.view),
    graphics: lenientObject(S.graphics, r.graphics),
    audio: lenientObject(S.audio, r.audio),
    hud: sanitizeHudLayout(r.hud),
  };
}

/** UTF-8 length of a string (no TextEncoder: works without DOM / Node types). */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Size of the settings as stored (`JSON.stringify`, UTF-8). */
export function playerSettingsByteSize(settings: unknown): number {
  return utf8ByteLength(JSON.stringify(settings) ?? '');
}

export type PlayerSettingsValidation =
  | { ok: true; data: PlayerSettings; bytes: number }
  | { ok: false; reason: 'too-large'; bytes: number }
  | { ok: false; reason: 'invalid'; issues: z.core.$ZodIssue[] };

/**
 * Server-side check of an incoming settings object: size limit on the raw JSON, then the strict
 * schema (unknown keys stripped, missing fields defaulted). Store `data`, not the input.
 */
export function validatePlayerSettings(raw: unknown): PlayerSettingsValidation {
  const bytes = playerSettingsByteSize(raw);
  if (bytes > PLAYER_SETTINGS_MAX_BYTES) return { ok: false, reason: 'too-large', bytes };
  const p = playerSettingsSchema.safeParse(raw);
  if (!p.success) return { ok: false, reason: 'invalid', issues: p.error.issues };
  return { ok: true, data: p.data, bytes: playerSettingsByteSize(p.data) };
}
