import { REAL_QUALITIES, type RealQuality } from '../../render/real/options.js';

/** What the browser says about touch (injected so tests need no DOM). */
export interface TouchEnv {
  /** `matchMedia('(pointer: coarse)').matches`. */
  coarse: boolean;
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints: number;
  /** `'ontouchstart' in window`. */
  touchEvents?: boolean;
}

/** Ustawienia › Sterowanie › Tryb sterowania (`settings.input.touchMode`). */
export type TouchPreference = 'auto' | 'touch' | 'mouse';

/** devicePixelRatio cap on touch devices (phones: fill rate), by render quality. */
export const TOUCH_DPR_CAP = { low: 1.5, medium: 2, high: 2 } as const;
/** Desktop cap (unchanged). */
export const DESKTOP_DPR_CAP = 2;

export interface TouchSettings {
  /** Touch controls on (phone / tablet, or `?touch=1`). */
  touch: boolean;
  /** Dev `?touchDebug=1`: invisible touch mode for tests (left-half drag = joystick). */
  debug: boolean;
  /** Render quality to use; `undefined` = keep the URL / default one. */
  quality: RealQuality | undefined;
  /** Ask for landscape (`screen.orientation.lock`), unless `?landscape=0`. */
  landscape: boolean;
}

/** Reads the browser's touch hints; safe outside a browser (no touch). */
export function browserTouchEnv(win: Partial<Window> | undefined = globalThis.window): TouchEnv {
  const coarse = !!win?.matchMedia?.('(pointer: coarse)').matches;
  const maxTouchPoints = win?.navigator?.maxTouchPoints ?? 0;
  return { coarse, maxTouchPoints, touchEvents: !!win && 'ontouchstart' in win };
}

/** A touch device: a coarse primary pointer with touch points (not a laptop with a touchscreen). */
export const isTouchDevice = (env: TouchEnv): boolean =>
  env.coarse && (env.maxTouchPoints > 0 || env.touchEvents === true);

/**
 * Touch defaults from the URL, the setting and the device. URL wins: `?touch=1|0` forces touch on
 * / off, `?quality=` keeps its value (touch only defaults it to `low`), `?landscape=0` skips the
 * lock. Without `?touch` the setting decides (Dotyk / Mysz), `auto` detects the device.
 */
export function touchSettings(
  search: string,
  env: TouchEnv,
  pref: TouchPreference = 'auto',
): TouchSettings {
  const q = new URLSearchParams(search);
  const flag = q.get('touch');
  const debug = q.get('touchDebug') === '1';
  const touch =
    flag === '1'
      ? true
      : flag === '0'
        ? false
        : debug || (pref === 'auto' ? isTouchDevice(env) : pref === 'touch');
  const urlQuality = (REAL_QUALITIES as readonly string[]).includes(q.get('quality') ?? '');
  return {
    touch,
    debug,
    quality: touch && !urlQuality ? 'low' : undefined,
    landscape: touch && q.get('landscape') !== '0',
  };
}

/**
 * Locks landscape where the browser allows it (usually only in fullscreen / installed PWA).
 * Resolves to whether the lock took; a refusal is not an error (the flag still says landscape).
 */
export async function lockLandscape(
  orientation: { lock?: (o: string) => Promise<void> } | undefined = globalThis.screen
    ?.orientation as { lock?: (o: string) => Promise<void> } | undefined,
): Promise<boolean> {
  if (!orientation?.lock) return false;
  try {
    await orientation.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

/** devicePixelRatio to render at: desktop as before (≤ 2), touch 1.5–2 by quality. */
export function pixelRatioFor(dpr: number, touch: boolean, quality: RealQuality): number {
  return Math.min(dpr, touch ? TOUCH_DPR_CAP[quality] : DESKTOP_DPR_CAP);
}
