import { z } from 'zod';
import { HUD_LAYOUT_VERSION, hudLayoutSchema } from '../hud-layout/schema.js';

/**
 * Player settings as stored in the cloud (`profiles.settings`) and validated by the server.
 * Mirrors apps/game/src/settings/schema.ts (client `Settings`, local version 4) plus `hud`
 * (HUD editor layout). Every field has a default; unknown keys are stripped.
 */
export const PLAYER_SETTINGS_VERSION = 1;
/** Server limit for `profiles.settings` (JSON, UTF-8). */
export const PLAYER_SETTINGS_MAX_BYTES = 16384;

export const GRAPHICS_STYLES = ['classic', 'outline', 'pixel', 'pixel-fine', 'painted'] as const;
export const VIEW_DISTANCES = ['low', 'medium', 'high'] as const;
export const NOISE_DISPLAYS = ['off', 'loud', 'always'] as const;
export const INVENTORY_VIEW_MODES = ['list', 'grid'] as const;
export const INVENTORY_SORTS = [
  'category',
  'name',
  'weight',
  'condition',
  'recent',
  'count',
] as const;
/** Inputs per action (client MAX_SLOTS). */
export const BINDING_SLOTS = 2;
export const BINDING_ACTIONS_MAX = 64;

const range = (min: number, max: number, d: number) =>
  z.number().finite().min(min).max(max).default(d);
const bool = (d: boolean) => z.boolean().default(d);

/**
 * Key bindings: action → input codes (e.g. `KeyF`, `Mouse0`, `WheelUp`). Only the shape is
 * checked here; the client drops unknown actions / codes (`sanitizeBindings`). Empty = defaults.
 */
export const bindingsSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/),
    z.array(z.string().regex(/^[A-Za-z0-9]{1,24}$/)).max(BINDING_SLOTS),
  )
  .refine((b) => Object.keys(b).length <= BINDING_ACTIONS_MAX, {
    message: `najwyżej ${BINDING_ACTIONS_MAX} akcji`,
  })
  .default({});

export const inputSettingsSchema = z.object({ bindings: bindingsSchema });

export const interfaceSettingsSchema = z.object({
  /** „Pokazuj hałas”: Wył. / Tylko głośne / Zawsze. */
  noiseDisplay: z.enum(NOISE_DISPLAYS).default('loud'),
  /** „Pokazuj życie zombie”. */
  showZombieHp: bool(false),
  targetZombieHp: bool(true),
});

const inventorySortSchema = z
  .object({ by: z.enum(INVENTORY_SORTS).default('category'), desc: bool(false) })
  .prefault({});

export const viewSettingsSchema = z.object({
  cameraZoom: range(0.25, 4, 1),
  /** Minimap zoom multiplier. */
  minimapZoom: range(0.25, 4, 1),
  /** Big map zoom: 0,05× and up (a 16 km map fits whole at ≈ 0,08–0,1×). */
  bigMapZoom: range(0.05, 4, 1),
  bigMapLayers: z
    .object({ markers: bool(true), trail: bool(true), grid: bool(false) })
    .prefault({}),
  inventoryView: z.enum(INVENTORY_VIEW_MODES).default('list'),
  inventorySort: z
    .object({ player: inventorySortSchema, container: inventorySortSchema })
    .prefault({}),
  inventoryGroup: bool(true),
});

export const graphicsSettingsSchema = z.object({
  /** „Styl grafiki”. */
  style: z.enum(GRAPHICS_STYLES).default('painted'),
  pixelRatioCap: range(0.5, 4, 2),
  antialias: bool(true),
  showFps: bool(false),
  /** „Zasięg widzenia”. */
  viewDistance: z.enum(VIEW_DISTANCES).default('medium'),
  /** „Skala interfejsu” 60–120 % (the client snaps to 5 % steps). */
  uiScale: range(0.6, 1.2, 0.9),
});

export const audioSettingsSchema = z.object({
  master: range(0, 1, 0.8),
  music: range(0, 1, 0.45),
  effects: range(0, 1, 0.85),
  ambience: range(0, 1, 0.7),
  voice: range(0, 1, 0.6),
  menuMusic: bool(true),
  muted: bool(false),
});

/** Sections resolved field by field in `resolveSettings`. */
export const PLAYER_SETTINGS_SECTIONS = {
  input: inputSettingsSchema,
  interface: interfaceSettingsSchema,
  view: viewSettingsSchema,
  graphics: graphicsSettingsSchema,
  audio: audioSettingsSchema,
} as const;

/** Strict validation (server): any out-of-range field fails; missing fields get defaults. */
export const playerSettingsSchema = z.object({
  version: z.literal(PLAYER_SETTINGS_VERSION).default(PLAYER_SETTINGS_VERSION),
  input: inputSettingsSchema.prefault({}),
  interface: interfaceSettingsSchema.prefault({}),
  view: viewSettingsSchema.prefault({}),
  graphics: graphicsSettingsSchema.prefault({}),
  audio: audioSettingsSchema.prefault({}),
  /** HUD editor: only changed elements (sparse). Full layout: `resolveLayout(settings.hud)`. */
  hud: hudLayoutSchema.prefault({ version: HUD_LAYOUT_VERSION, elements: {} }),
});

export type PlayerSettings = z.output<typeof playerSettingsSchema>;
export type PlayerSettingsInput = z.input<typeof playerSettingsSchema>;
