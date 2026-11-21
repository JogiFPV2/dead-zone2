import { Color } from 'three';
import type { WeatherView } from '@deadzone/protocol';
import type { CompiledPreset } from './compiled.js';

/**
 * Weather and moon on the sampled day-cycle look (in place, allocation-free), the same numbers the
 * sim uses for light and sight (`WeatherView`, protocol 50):
 * - clouds dim the sun and soften its shadows, grey the sky and the fog;
 * - at night the moon light follows the phase (full moon = the approved night look, new moon
 *   much darker) and clouds hide it;
 * - fog (and a little rain / snow) pulls the fog in and lightens it.
 */
export const WEATHER_LOOK = {
  /** Sun intensity and shadow darkness × (1 − this × cloud) by day. */
  cloudSunDim: 0.7,
  cloudShadowDim: 0.85,
  /** Hemisphere fill × (1 − this × cloud) (overcast days are flatter, not much darker). */
  cloudFillDim: 0.2,
  /** Sky, background and fog colours move this far towards grey at full cloud cover. */
  cloudGrey: 0.55,
  /** Moon light at new moon (× full-moon light) and the share clouds hide at night. */
  newMoon: 0.2,
  cloudMoonDim: 0.75,
  /** Fill light at night: new moon × this. */
  newMoonFill: 0.55,
  /**
   * Thickest fog (sight × 0.45): fog from this view depth to this one (spec camera at 80 m from
   * the player, so the player stays clear and things ~30 m away fade out).
   */
  fogNear: 68,
  fogFar: 112,
  /** Fog colour lightens this far towards `fogDay` / `fogNight` in thick fog. */
  fogTint: 0.7,
} as const;

// `Color('#hex')` is sRGB → linear already (ColorManagement on).
const GREY_DAY = new Color('#8c9298');
const GREY_NIGHT = new Color('#101315');
const FOG_DAY = new Color('#b8bec4');
const FOG_NIGHT = new Color('#1c2124');
const tmp = new Color();

/**
 * Fog thickness 0..1 from the weather's sight multiplier (1 = clear, 0.45 = thick fog), squared
 * so rain (0.8) and storms (0.65) only haze the distance.
 */
export function fogAmount(wx: WeatherView): number {
  const k = Math.max(0, Math.min(1, (1 - wx.sightMul) / 0.55));
  return k * k;
}

/**
 * `day` = 0..1 weight of daylight (1 = sun up, 0 = night; from the sun elevation). Returns the
 * fog amount (for particles / debug).
 */
export function applyWeatherLook(
  out: CompiledPreset,
  wx: WeatherView | undefined,
  day: number,
  o: typeof WEATHER_LOOK = WEATHER_LOOK,
): number {
  if (!wx) return 0;
  const c = wx.cloud;
  const night = 1 - day;
  const d = out.directional;
  // Sun by day, moon at night.
  const sunMul = 1 - o.cloudSunDim * c;
  const moonMul = (o.newMoon + (1 - o.newMoon) * wx.moon) * (1 - o.cloudMoonDim * c);
  d.intensity *= day * sunMul + night * moonMul;
  d.shadowIntensity *= day * (1 - o.cloudShadowDim * c) + night * moonMul;
  const fillNight = o.newMoonFill + (1 - o.newMoonFill) * wx.moon;
  out.hemisphere.intensity *= (1 - o.cloudFillDim * c) * (day + night * fillNight);
  // Overcast colours: towards grey.
  const grey = tmp.copy(GREY_NIGHT).lerp(GREY_DAY, day);
  const g = o.cloudGrey * c;
  out.hemisphere.sky.lerp(grey, g);
  out.background.lerp(grey, g);
  out.fog.color.lerp(grey, g);
  // Fog.
  const f = fogAmount(wx);
  if (f > 0) {
    out.fog.far += (Math.min(out.fog.far, o.fogFar) - out.fog.far) * f;
    out.fog.near += (Math.min(out.fog.near, o.fogNear) - out.fog.near) * f;
    const tint = tmp.copy(FOG_NIGHT).lerp(FOG_DAY, day);
    out.fog.color.lerp(tint, o.fogTint * f);
    out.background.lerp(tint, o.fogTint * f);
  }
  return f;
}
