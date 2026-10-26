import { DEFAULT_BINDINGS, sanitizeBindings, type Bindings } from '../input/bindings.js';
import { UI_SCALE_DEFAULT, snapUiScale } from '../ui/ui-scale.js';
import { RENDER_STYLES, type RenderStyle } from '../render/real/options.js';

/** Bump when the persisted shape changes and add a migration from the previous version. */
export const SETTINGS_VERSION = 4;

/**
 * „Styl grafiki” (#71): classic low-poly, outlines + toon bands, low-res pixel art (3 px) and
 * the finer „Pikselowy ostry” (2 px). Persisted and shown in Ustawienia › Grafika; the renderer
 * applies it (render/graphics-style.ts). New ids are appended: stored values keep their meaning.
 */
export const GRAPHICS_STYLES = ['classic', 'outline', 'pixel', 'pixel-fine'] as const;
export type GraphicsStyle = (typeof GRAPHICS_STYLES)[number];

/** Graphics: `style` (renderer); the other fields are stored, not applied by the game yet. */
export interface GraphicsSettings {
  style: GraphicsStyle;
  /** Cap for devicePixelRatio (the game uses 2 today). */
  pixelRatioCap: number;
  antialias: boolean;
  showFps: boolean;
  /**
   * „Zasięg widzenia”: chunk streaming ring radii / budgets (world/streaming/rings.ts presets).
   * Ustawienia › Grafika › Zasięg widzenia; `?view=` overrides it.
   */
  viewDistance: ViewDistance;
  /**
   * „Skala interfejsu”: 0.6–1.2 in 5 % steps, multiplies every UI layer (ui/ui-scale.ts). Added
   * without a version bump: older files lack it and get the default.
   */
  uiScale: number;
  /**
   * „Styl grafiki” (Realistyczny, one row with `style`): `default` = Klasyczny (low-poly, today's look), `real` = Realistyczny (PBR
   * pilot, render/real). Read at game start; `?style=real|classic` overrides it. Added without a
   * version bump: older files lack it and get the classic look.
   */
  renderStyle: RenderStyle;
}

export const VIEW_DISTANCE_SETTINGS = ['low', 'medium', 'high'] as const;
export type ViewDistance = (typeof VIEW_DISTANCE_SETTINGS)[number];

/**
 * Volumes 0..1 (shown as 0–100 in Ustawienia › Audio; gain = v², spec deadzone-menu-spec §5).
 * Buses: master, music, effects = sfx (weapons, steps, zombies), ambience (wind, rain, town),
 * voice = voices + UI clicks.
 */
export interface AudioSettings {
  master: number;
  music: number;
  effects: number;
  ambience: number;
  voice: number;
  /** „Muzyka w menu”: soundtrack in the main menu (and pause later). */
  menuMusic: boolean;
  muted: boolean;
}

/**
 * „Pokazuj hałas”: the noise circle of the own character (hud/noise). `loud` = radius ≥ 10 m.
 * Added without a version bump (older files lack it, sanitize fills the default).
 */
export const NOISE_DISPLAYS = ['off', 'loud', 'always'] as const;
export type NoiseDisplay = (typeof NOISE_DISPLAYS)[number];

/** World overlays (zombie health, noise circle). */
export interface InterfaceSettings {
  /** „Pokazuj hałas”: Wył. / Tylko głośne (default) / Zawsze. */
  noiseDisplay: NoiseDisplay;
  /** „Pokazuj życie zombie”: small bar over every wounded zombie (off: only the target). */
  showZombieHp: boolean;
  /** Shift + LMB on a zombie marks it as the target and shows its health bubble. */
  targetZombieHp: boolean;
}

/**
 * View state remembered between sessions (mouse wheel / minimap +−). Added without a version
 * bump: older files simply lack it and sanitize fills the defaults.
 */
export interface ViewSettings {
  /** Ortho camera zoom (1 = default view; clamped to camera/zoom.ts limits). */
  cameraZoom: number;
  /** Minimap scale multiplier (1 = spec 2.5 px/m; steps in hud/minimap-zoom.ts). */
  minimapZoom: number;
  /** Big map (M): last zoom (0.25–4) and layer toggles (HUD v2 spec §11). */
  bigMapZoom: number;
  bigMapLayers: { markers: boolean; trail: boolean; grid: boolean };
  /** Inventory v3: list or grid (Tab switches both panels). */
  inventoryView: InventoryViewMode;
  /** Inventory v3: sort per panel (dropdown / column header, second click reverses). */
  inventorySort: { player: InventorySortSetting; container: InventorySortSetting };
  /** Inventory v3: „Grupuj stosy” (same item, different state → one row with a chevron). */
  inventoryGroup: boolean;
}

export const INVENTORY_VIEW_MODES = ['list', 'grid'] as const;
export type InventoryViewMode = (typeof INVENTORY_VIEW_MODES)[number];
/** Dropdown keys + the `count` column header. */
export const INVENTORY_SORTS = [
  'category',
  'name',
  'weight',
  'condition',
  'recent',
  'count',
] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];
export interface InventorySortSetting {
  by: InventorySort;
  desc: boolean;
}

/** Ustawienia › Sterowanie › Tryb sterowania: auto-detect, touch controls or mouse + keyboard. */
export const TOUCH_MODES = ['auto', 'touch', 'mouse'] as const;
export type TouchModeSetting = (typeof TOUCH_MODES)[number];

export interface Settings {
  version: typeof SETTINGS_VERSION;
  input: { bindings: Bindings; touchMode: TouchModeSetting };
  interface: InterfaceSettings;
  view: ViewSettings;
  graphics: GraphicsSettings;
  audio: AudioSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  input: { bindings: DEFAULT_BINDINGS, touchMode: 'auto' },
  interface: { noiseDisplay: 'loud', showZombieHp: false, targetZombieHp: true },
  view: {
    cameraZoom: 1,
    minimapZoom: 1,
    bigMapZoom: 1,
    bigMapLayers: { markers: true, trail: true, grid: false },
    inventoryView: 'list',
    inventorySort: {
      player: { by: 'category', desc: false },
      container: { by: 'category', desc: false },
    },
    inventoryGroup: true,
  },
  graphics: {
    style: 'classic',
    pixelRatioCap: 2,
    antialias: true,
    showFps: false,
    viewDistance: 'medium',
    uiScale: UI_SCALE_DEFAULT,
    renderStyle: 'default',
  },
  audio: {
    master: 0.8,
    music: 0.45,
    effects: 0.85,
    ambience: 0.7,
    voice: 0.6,
    menuMusic: true,
    muted: false,
  },
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : d;
const invSort = (v: unknown, d: InventorySortSetting): InventorySortSetting => {
  const o = obj(v);
  return { by: oneOf(INVENTORY_SORTS, o.by, d.by), desc: bool(o.desc, d.desc) };
};
const range = (v: unknown, min: number, max: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;

/**
 * Field-by-field validation of already-migrated data: a bad field falls back to its default
 * instead of discarding the whole file (manual — the game has no direct zod dependency).
 */
export function sanitizeSettings(raw: unknown): Settings {
  const r = obj(raw);
  const g = obj(r.graphics);
  const a = obj(r.audio);
  const ui = obj(r.interface);
  const v = obj(r.view);
  const dv = DEFAULT_SETTINGS.view;
  const di = DEFAULT_SETTINGS.interface;
  const dg = DEFAULT_SETTINGS.graphics;
  const da = DEFAULT_SETTINGS.audio;
  return {
    version: SETTINGS_VERSION,
    input: {
      bindings: sanitizeBindings(obj(r.input).bindings),
      touchMode: (TOUCH_MODES as readonly unknown[]).includes(obj(r.input).touchMode)
        ? (obj(r.input).touchMode as TouchModeSetting)
        : 'auto',
    },
    interface: {
      noiseDisplay: (NOISE_DISPLAYS as readonly unknown[]).includes(ui.noiseDisplay)
        ? (ui.noiseDisplay as NoiseDisplay)
        : di.noiseDisplay,
      showZombieHp: bool(ui.showZombieHp, di.showZombieHp),
      targetZombieHp: bool(ui.targetZombieHp, di.targetZombieHp),
    },
    view: {
      cameraZoom: range(v.cameraZoom, 0.25, 4, dv.cameraZoom),
      // 0.05: the phone's 480 m level (minimap-levels.ts) is ≈ 0.06.
      minimapZoom: range(v.minimapZoom, 0.05, 4, dv.minimapZoom),
      bigMapZoom: range(v.bigMapZoom, 0.05, 4, dv.bigMapZoom),
      bigMapLayers: {
        markers: bool(obj(v.bigMapLayers).markers, dv.bigMapLayers.markers),
        trail: bool(obj(v.bigMapLayers).trail, dv.bigMapLayers.trail),
        grid: bool(obj(v.bigMapLayers).grid, dv.bigMapLayers.grid),
      },
      inventoryView: oneOf(INVENTORY_VIEW_MODES, v.inventoryView, dv.inventoryView),
      inventorySort: {
        player: invSort(obj(v.inventorySort).player, dv.inventorySort.player),
        container: invSort(obj(v.inventorySort).container, dv.inventorySort.container),
      },
      inventoryGroup: bool(v.inventoryGroup, dv.inventoryGroup),
    },
    graphics: {
      style: (GRAPHICS_STYLES as readonly unknown[]).includes(g.style)
        ? (g.style as GraphicsStyle)
        : dg.style,
      pixelRatioCap: range(g.pixelRatioCap, 0.5, 4, dg.pixelRatioCap),
      antialias: bool(g.antialias, dg.antialias),
      showFps: bool(g.showFps, dg.showFps),
      viewDistance: (VIEW_DISTANCE_SETTINGS as readonly unknown[]).includes(g.viewDistance)
        ? (g.viewDistance as ViewDistance)
        : dg.viewDistance,
      uiScale: typeof g.uiScale === 'number' ? snapUiScale(g.uiScale) : dg.uiScale,
      renderStyle: oneOf(RENDER_STYLES, g.renderStyle, dg.renderStyle),
    },
    audio: {
      master: range(a.master, 0, 1, da.master),
      music: range(a.music, 0, 1, da.music),
      effects: range(a.effects, 0, 1, da.effects),
      ambience: range(a.ambience, 0, 1, da.ambience),
      voice: range(a.voice, 0, 1, da.voice),
      menuMusic: bool(a.menuMusic, da.menuMusic),
      muted: bool(a.muted, da.muted),
    },
  };
}
