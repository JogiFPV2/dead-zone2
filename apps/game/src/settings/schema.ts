import { DEFAULT_BINDINGS, sanitizeBindings, type Bindings } from '../input/bindings.js';

/** Bump when the persisted shape changes and add a migration from the previous version. */
export const SETTINGS_VERSION = 4;

/**
 * „Styl grafiki” (post-process on the same models): classic low-poly, outlines + toon bands,
 * low-res pixel art. Applied live (`render/graphics-style.ts`).
 */
export const GRAPHICS_STYLES = ['classic', 'outline', 'pixel'] as const;
export type GraphicsStyle = (typeof GRAPHICS_STYLES)[number];

/** Graphics: `style` is applied; the other fields are placeholders for the settings screen. */
export interface GraphicsSettings {
  style: GraphicsStyle;
  /** Cap for devicePixelRatio (the game uses 2 today). */
  pixelRatioCap: number;
  antialias: boolean;
  showFps: boolean;
}

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

/** World overlays (zombie health). */
export interface InterfaceSettings {
  /** „Pokazuj życie zombie”: small bar over every wounded zombie (off: only the target). */
  showZombieHp: boolean;
  /** Shift + LMB on a zombie marks it as the target and shows its health bubble. */
  targetZombieHp: boolean;
}

export interface Settings {
  version: typeof SETTINGS_VERSION;
  input: { bindings: Bindings };
  interface: InterfaceSettings;
  graphics: GraphicsSettings;
  audio: AudioSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  input: { bindings: DEFAULT_BINDINGS },
  interface: { showZombieHp: false, targetZombieHp: true },
  graphics: { style: 'classic', pixelRatioCap: 2, antialias: true, showFps: false },
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
  const di = DEFAULT_SETTINGS.interface;
  const dg = DEFAULT_SETTINGS.graphics;
  const da = DEFAULT_SETTINGS.audio;
  return {
    version: SETTINGS_VERSION,
    input: { bindings: sanitizeBindings(obj(r.input).bindings) },
    interface: {
      showZombieHp: bool(ui.showZombieHp, di.showZombieHp),
      targetZombieHp: bool(ui.targetZombieHp, di.targetZombieHp),
    },
    graphics: {
      style: (GRAPHICS_STYLES as readonly unknown[]).includes(g.style)
        ? (g.style as GraphicsStyle)
        : dg.style,
      pixelRatioCap: range(g.pixelRatioCap, 0.5, 4, dg.pixelRatioCap),
      antialias: bool(g.antialias, dg.antialias),
      showFps: bool(g.showFps, dg.showFps),
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
