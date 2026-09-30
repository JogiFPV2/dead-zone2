import { Color } from 'three';

/** A colour as a CSS hex string in sRGB (`#rrggbb`), as written in the spec. */
export type Hex = `#${string}`;

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Everything that differs between times of day. Only blendable values live here (numbers,
 * colours, vectors); structural renderer settings are in `LIGHTING_CONFIG`.
 */
export interface LightingPreset {
  readonly exposure: number;
  readonly background: Hex;
  /**
   * Linear fog. `near`/`far` are view depths for a camera `SPEC_CAMERA_DISTANCE` away from its
   * target (as in the reference scene); `fogRange` rescales them to the real camera distance.
   */
  readonly fog: { readonly color: Hex; readonly near: number; readonly far: number };
  /** No AmbientLight: the hemisphere light is the only fill. */
  readonly hemisphere: { readonly sky: Hex; readonly ground: Hex; readonly intensity: number };
  /** Moon (night) / sun (day). `offset` = light position relative to the followed target. */
  readonly directional: {
    readonly color: Hex;
    readonly intensity: number;
    readonly offset: Vec3Like;
    readonly shadowRadius: number;
    readonly shadowIntensity: number;
  };
  /** Street lamps: SpotLight parameters + emissive bulb + additive glow decal. */
  readonly lamps: {
    readonly color: Hex;
    readonly intensity: number;
    readonly distance: number;
    readonly angle: number;
    readonly penumbra: number;
    readonly decay: number;
    readonly bulbColor: Hex;
    readonly bulbEmissive: Hex;
    readonly bulbEmissiveIntensity: number;
    /** Multiplier of the glow decal opacity (0 hides it). */
    readonly glow: number;
  };
}

/** Camera distance of the reference scene (`deadzone-concepts/iso/scene.html`). */
export const SPEC_CAMERA_DISTANCE = 80;

/** Non-blendable settings shared by all presets (spec 4.1). */
export const LIGHTING_CONFIG = {
  /** Moon shadow map; the frustum is fitted to the camera view every frame. */
  shadowMapSize: 4096,
  shadowBias: -0.0005,
  shadowNormalBias: 0.03,
  lampShadowMapSize: 1024,
  lampShadowRadius: 6,
  lampShadowBias: -0.0008,
  /** Height of the spot light (just under the lamp head). */
  lampLightHeight: 4.1,
} as const;

/** NIGHT, approved (spec 4.1, values from the reference scene). The default look. */
export const NIGHT_PRESET: LightingPreset = {
  exposure: 1.25,
  background: '#0d1112',
  fog: { color: '#0d1214', near: 60, far: 110 },
  hemisphere: { sky: '#7890a4', ground: '#262b24', intensity: 1.25 },
  directional: {
    color: '#a8bcd8',
    intensity: 1.5,
    offset: { x: -30, y: 50, z: 20 },
    shadowRadius: 4,
    shadowIntensity: 1,
  },
  lamps: {
    color: '#ff9a45',
    intensity: 70,
    distance: 16,
    angle: Math.PI / 3.2,
    penumbra: 0.75,
    decay: 1.6,
    bulbColor: '#ffd9a0',
    bulbEmissive: '#ffc070',
    bulbEmissiveIntensity: 3,
    glow: 1,
  },
};
// DAY (spec 4.2) is still a proposal: add it here once approved and blend with `blendPresets`.

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite smoothstep of t clamped to [0, 1]. */
export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

const ca = new Color();
const cb = new Color();
/** Lerps two sRGB hex colours in linear space (three's Color stores linear values). */
export function lerpColor(a: Hex, b: Hex, t: number): Hex {
  if (a === b) return a;
  return `#${ca.set(a).lerp(cb.set(b), t).getHexString()}`;
}

type Blendable = number | string | { readonly [k: string]: Blendable };

function lerpValue<T extends Blendable>(a: T, b: T, t: number): T {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t) as T;
  if (typeof a === 'string' && typeof b === 'string') {
    return lerpColor(a as Hex, b as Hex, t) as T;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, Blendable> = {};
    for (const k of Object.keys(a)) out[k] = lerpValue(a[k] as Blendable, b[k] as Blendable, t);
    return out as T;
  }
  throw new TypeError('lerpPreset: mismatched preset shapes');
}

/** Linear blend of two presets (colours in linear space, scalars linearly), t in [0, 1]. */
export function lerpPreset(a: LightingPreset, b: LightingPreset, t: number): LightingPreset {
  const x = Math.min(1, Math.max(0, t));
  if (x === 0) return a;
  if (x === 1) return b;
  return lerpValue(
    a as unknown as Blendable,
    b as unknown as Blendable,
    x,
  ) as unknown as LightingPreset;
}

/** Spec 4.3 transition: linear blend with smoothstep on t. */
export const blendPresets = (a: LightingPreset, b: LightingPreset, t: number): LightingPreset =>
  lerpPreset(a, b, smoothstep(t));

/** Fog range for the actual camera distance (keeps the reference fog around the target). */
export function fogRange(
  fog: LightingPreset['fog'],
  cameraDistance: number,
): { near: number; far: number } {
  const shift = cameraDistance - SPEC_CAMERA_DISTANCE;
  return { near: fog.near + shift, far: fog.far + shift };
}
