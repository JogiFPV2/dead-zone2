import {
  weatherAt,
  type WeatherKind,
  type WeatherTiming,
  type WeatherView,
} from '@deadzone/protocol';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';

/**
 * Weather of a world (docs 9.45 „Pogoda i księżyc”): `weatherAt(seed, minute)` from
 * `@deadzone/protocol`, so it is not saved and not hashed (a function of seed and clock).
 * `forced` pins one kind (dev `?weather=`, tests). Undefined config = weather off: the old
 * constant moonlight and no effects.
 */
export interface WeatherConfig {
  timing: WeatherTiming;
  forced?: WeatherKind | undefined;
}

const cache = new WeakMap<SimWorld, { minute: number; view: WeatherView }>();

/** Weather at an absolute game minute (default: now); undefined when weather is off. */
export function weatherNow(w: SimWorld, minute?: number): WeatherView | undefined {
  const cfg = w.weather;
  if (!cfg) return undefined;
  const m = minute ?? gameMinuteAt(w.clock, w.tick);
  const c = cache.get(w);
  if (c?.minute === m) return c.view;
  const view = weatherAt(w.seed, m, cfg.timing, cfg.forced);
  cache.set(w, { minute: m, view });
  return view;
}
