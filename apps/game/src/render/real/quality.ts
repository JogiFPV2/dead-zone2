import type { RealQuality } from './options.js';

/**
 * Quality presets of the realistic style. Values are the table of `assets-src/pbr/STYLE.md` §5
 * (Designer) as data: a later STYLE.md change drops in here (or via `withOverrides` from a JSON
 * next to the textures) without touching the render code.
 */
export interface RealQualityPreset {
  /** Texture array resolution (`deadzone-pbr-*-<size>.ktx2`). */
  readonly textureSize: 512 | 1024;
  readonly anisotropy: number;
  readonly shadow: {
    readonly mapSize: number;
    /** PCF blur radius (`DirectionalLight.shadow.radius`). */
    readonly radius: number;
    readonly bias: number;
    readonly normalBias: number;
  };
  /** Screen-space AO (GTAO); `off` keeps only the AO baked in the ORM texture. */
  readonly ssao:
    | { readonly mode: 'off' }
    | { readonly mode: 'gtao'; readonly resolutionScale: number; readonly samples: number };
  /** RoomEnvironment ambient intensity (0 = no environment map). */
  readonly envIntensity: number;
  /** Normal map strength. */
  readonly normalScale: number;
  /** Share of the texture AO (ORM.r) in the albedo. */
  readonly textureAO: number;
  /** Device pixel ratio cap. */
  readonly pixelRatioMax: number;
  /** MSAA samples of the composer target (the canvas antialias does not apply to it). */
  readonly msaa: number;
  /** Budget: draw calls per frame incl. shadow passes (PLAN.md: < 250 on an integrated GPU). */
  readonly maxDrawCalls: number;
  /** Frame-rate target the preset is tuned for. */
  readonly targetFps: number;
}

const SHADOW_COMMON = { bias: -0.0005, normalBias: 0.09 } as const;

export const REAL_QUALITY: Readonly<Record<RealQuality, RealQualityPreset>> = {
  low: {
    textureSize: 512,
    anisotropy: 1,
    shadow: { mapSize: 1024, radius: 1, ...SHADOW_COMMON },
    ssao: { mode: 'off' },
    envIntensity: 0,
    normalScale: 0.8,
    textureAO: 0.8,
    pixelRatioMax: 1,
    msaa: 0,
    maxDrawCalls: 250,
    targetFps: 60,
  },
  medium: {
    textureSize: 1024,
    anisotropy: 4,
    shadow: { mapSize: 2048, radius: 2.5, ...SHADOW_COMMON },
    ssao: { mode: 'gtao', resolutionScale: 0.5, samples: 8 },
    envIntensity: 0,
    normalScale: 1,
    textureAO: 0.8,
    pixelRatioMax: 1.5,
    msaa: 4,
    maxDrawCalls: 400,
    targetFps: 60,
  },
  high: {
    textureSize: 1024,
    anisotropy: 8,
    shadow: { mapSize: 4096, radius: 4, ...SHADOW_COMMON },
    ssao: { mode: 'gtao', resolutionScale: 1, samples: 16 },
    envIntensity: 0.12,
    normalScale: 1,
    textureAO: 0.8,
    pixelRatioMax: 2,
    msaa: 4,
    maxDrawCalls: 600,
    targetFps: 60,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type QualityOverrides = Partial<Record<RealQuality, DeepPartial<RealQualityPreset>>>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const GTAO_DEFAULT = { mode: 'gtao', resolutionScale: 1, samples: 8 } as const;

function mergeSsao(cur: unknown, v: Record<string, unknown>): RealQualityPreset['ssao'] {
  if (v.mode === 'off') return { mode: 'off' };
  const base = isObj(cur) && cur.mode === 'gtao' ? cur : GTAO_DEFAULT;
  const num = (k: 'resolutionScale' | 'samples'): number =>
    typeof v[k] === 'number' && v[k] > 0 ? v[k] : (base[k] as number);
  return { mode: 'gtao', resolutionScale: num('resolutionScale'), samples: num('samples') };
}

function merge<T>(base: T, over: unknown): T {
  if (!isObj(over) || !isObj(base)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const cur = out[k];
    if (k === 'ssao') {
      if (isObj(v) && (v.mode === 'off' || v.mode === 'gtao')) out[k] = mergeSsao(cur, v);
    } else if (isObj(v) && isObj(cur)) out[k] = merge(cur, v);
    else if (typeof v === typeof cur) out[k] = v;
  }
  return out as T;
}

/** Presets with overrides (e.g. parsed from a JSON exported from STYLE.md); bad fields ignored. */
export function withOverrides(
  over: unknown,
  base: Readonly<Record<RealQuality, RealQualityPreset>> = REAL_QUALITY,
): Record<RealQuality, RealQualityPreset> {
  const o = isObj(over) ? over : {};
  return {
    low: merge(base.low, o.low),
    medium: merge(base.medium, o.medium),
    high: merge(base.high, o.high),
  };
}

export interface DrawBudget {
  readonly calls: number;
  readonly max: number;
  readonly ok: boolean;
}

/** Draw calls of a frame (incl. shadow passes) against the preset budget. */
export const checkDrawBudget = (calls: number, preset: RealQualityPreset): DrawBudget => ({
  calls,
  max: preset.maxDrawCalls,
  ok: calls < preset.maxDrawCalls,
});
