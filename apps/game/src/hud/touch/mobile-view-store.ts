import { clamp, type ZoomLimits } from '../../camera/zoom.js';

/** Phone camera zoom: 0.6× – 6× (same as desktop, DEFAULT_ZOOM_LIMITS). */
export const TOUCH_ZOOM_LIMITS: ZoomLimits = { min: 0.6, max: 6, step: 1.12 };

/** Phone view state in its own localStorage keys (mobile HUD spec). */
export const MOBILE_VIEW_KEYS = {
  cameraZoom: 'dz.mobile.cameraZoom',
  minimapZoom: 'dz.mobile.minimapZoom',
  bigMapZoom: 'dz.mobile.bigmapZoom',
} as const;
export type MobileViewKey = keyof typeof MOBILE_VIEW_KEYS;
export const MOBILE_VIEW_DEBOUNCE_MS = 300;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export interface MobileViewStore {
  get(key: MobileViewKey): number;
  /** Debounced (300 ms) per key. */
  set(key: MobileViewKey, value: number): void;
  /** Write pending values now (tests, pagehide). */
  flush(): void;
}

/**
 * `migrate` holds the values saved so far (the settings' view.*): a key that is not stored yet
 * starts from them and is written at once, so nothing saved is lost.
 */
export function createMobileViewStore(
  storage: Storage | undefined,
  migrate: Record<MobileViewKey, number>,
  debounceMs = MOBILE_VIEW_DEBOUNCE_MS,
): MobileViewStore {
  const values = { ...migrate };
  const read = (k: MobileViewKey): void => {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(MOBILE_VIEW_KEYS[k]) ?? null;
    } catch {
      /* private mode */
    }
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n) && n > 0) values[k] = n;
    else write(k);
  };
  const write = (k: MobileViewKey): void => {
    try {
      storage?.setItem(MOBILE_VIEW_KEYS[k], String(values[k]));
    } catch {
      /* quota / private mode */
    }
  };
  (Object.keys(MOBILE_VIEW_KEYS) as MobileViewKey[]).forEach(read);
  const timers = new Map<MobileViewKey, ReturnType<typeof setTimeout>>();
  const flushKey = (k: MobileViewKey): void => {
    const t = timers.get(k);
    if (t === undefined) return;
    clearTimeout(t);
    timers.delete(k);
    write(k);
  };
  return {
    get: (k) => values[k],
    set(k, v) {
      if (!(v > 0)) return;
      values[k] = v;
      const t = timers.get(k);
      if (t !== undefined) clearTimeout(t);
      timers.set(
        k,
        setTimeout(() => flushKey(k), debounceMs),
      );
    },
    flush: () => [...timers.keys()].forEach(flushKey),
  };
}

export const clampTouchZoom = (z: number): number =>
  clamp(z, TOUCH_ZOOM_LIMITS.min, TOUCH_ZOOM_LIMITS.max);
