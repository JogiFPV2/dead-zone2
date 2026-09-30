import { DEFAULT_BINDINGS, sanitizeBindings, type Bindings } from '../input/bindings.js';

/** Bump when the persisted shape changes and add a migration from the previous version. */
export const SETTINGS_VERSION = 1;

/** Graphics/audio are placeholders for the settings screen (Designer); not applied yet. */
export interface GraphicsSettings {
  /** Cap for devicePixelRatio (the game uses 2 today). */
  pixelRatioCap: number;
  antialias: boolean;
  showFps: boolean;
}

export interface AudioSettings {
  /** 0..1 */
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

export interface Settings {
  version: typeof SETTINGS_VERSION;
  input: { bindings: Bindings };
  graphics: GraphicsSettings;
  audio: AudioSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  input: { bindings: DEFAULT_BINDINGS },
  graphics: { pixelRatioCap: 2, antialias: true, showFps: false },
  audio: { master: 1, music: 0.6, effects: 0.8, muted: false },
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
  const dg = DEFAULT_SETTINGS.graphics;
  const da = DEFAULT_SETTINGS.audio;
  return {
    version: SETTINGS_VERSION,
    input: { bindings: sanitizeBindings(obj(r.input).bindings) },
    graphics: {
      pixelRatioCap: range(g.pixelRatioCap, 0.5, 4, dg.pixelRatioCap),
      antialias: bool(g.antialias, dg.antialias),
      showFps: bool(g.showFps, dg.showFps),
    },
    audio: {
      master: range(a.master, 0, 1, da.master),
      music: range(a.music, 0, 1, da.music),
      effects: range(a.effects, 0, 1, da.effects),
      muted: bool(a.muted, da.muted),
    },
  };
}
