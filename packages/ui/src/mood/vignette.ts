/**
 * HUD vignette over the day (Designer, answer 1): keyframes day → dusk → night, interpolated
 * (smoothstep, like the lighting in spec §4.3) instead of a hard switch.
 * Dusk = night vignette at 60% strength (`color.overlay.vignette.dusk`).
 */
import { tokens } from '../tokens/tokens.generated.js';
import { setHudChips, type ChipMode, type HudMood } from './mood.js';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseRgba(value: string): Rgba {
  const m = /^rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/.exec(value);
  if (!m) throw new Error(`not an rgba() colour: ${value}`);
  const [r, g, b, a] = m.slice(1).map(Number) as [number, number, number, number];
  return { r, g, b, a };
}

export const formatRgba = ({ r, g, b, a }: Rgba): string =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;

export const VIGNETTE: Record<HudMood, Rgba> = {
  day: parseRgba(tokens.color.overlay.vignette.day),
  dusk: parseRgba(tokens.color.overlay.vignette.dusk),
  night: parseRgba(tokens.color.overlay.vignette.night),
};

const hm = (h: number, m = 0): number => h * 60 + m;

/**
 * Game-time keyframes (minutes of day). Spec §4.3: day 06:30–18:30, dusk 18:30–20:30 (keyframe
 * at 19:30), night 20:30–05:00, dawn 05:00–06:30 (reverse order, keyframe at 05:45).
 */
export const MOOD_KEYFRAMES: readonly { at: number; mood: HudMood }[] = [
  { at: hm(5), mood: 'night' },
  { at: hm(5, 45), mood: 'dusk' },
  { at: hm(6, 30), mood: 'day' },
  { at: hm(18, 30), mood: 'day' },
  { at: hm(19, 30), mood: 'dusk' },
  { at: hm(20, 30), mood: 'night' },
];

const DAY_MINUTES = 24 * 60;
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Surrounding keyframes and the eased blend factor (0 → from, 1 → to) for a time of day. */
export function moodBlendAt(minutesOfDay: number): { from: HudMood; to: HudMood; t: number } {
  const m = ((minutesOfDay % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const n = MOOD_KEYFRAMES.length;
  for (let i = 0; i < n; i++) {
    const a = MOOD_KEYFRAMES[i]!;
    const b = MOOD_KEYFRAMES[(i + 1) % n]!;
    const end = b.at > a.at ? b.at : b.at + DAY_MINUTES;
    const mm = m < a.at ? m + DAY_MINUTES : m;
    if (mm >= a.at && mm < end)
      return { from: a.mood, to: b.mood, t: smoothstep((mm - a.at) / (end - a.at)) };
  }
  return { from: 'night', to: 'night', t: 0 };
}

/** Blends two moods (t = 0 → a, 1 → b). */
export function mixVignette(a: HudMood, b: HudMood, t: number): string {
  const x = VIGNETTE[a];
  const y = VIGNETTE[b];
  const k = Math.min(1, Math.max(0, t));
  return formatRgba({
    r: lerp(x.r, y.r, k),
    g: lerp(x.g, y.g, k),
    b: lerp(x.b, y.b, k),
    a: lerp(x.a, y.a, k),
  });
}

/** Vignette colour for a game time (minutes since 00:00). */
export function vignetteAt(minutesOfDay: number): string {
  const { from, to, t } = moodBlendAt(minutesOfDay);
  return mixVignette(from, to, t);
}

/** Nearest keyframe mood, for `HudState.mood`. */
export function moodAt(minutesOfDay: number): HudMood {
  const { from, to, t } = moodBlendAt(minutesOfDay);
  return t < 0.5 ? from : to;
}

/**
 * Chip set for a game time. Chip backgrounds do not interpolate (a half-opaque chip would fail
 * contrast on a half-bright scene); they switch. The day set stays on for the whole stretch where
 * the scene is between day and dusk brightness (06:30 → 19:30, and from 05:45 at dawn), and the
 * night set takes over once the scene is at dusk darkness or darker. Both sets pass 4.5:1 on the
 * dusk scene, so the switch point is never a contrast cliff.
 */
export function chipModeAt(minutesOfDay: number): ChipMode {
  const { from, to } = moodBlendAt(minutesOfDay);
  return from === 'day' || to === 'day' ? 'day' : 'night';
}

/**
 * Sets `--hud-vignette` and the chip set on the game root for a game time (call once per game
 * minute). Overrides the discrete `data-hud-mood` value.
 */
export function applyVignetteAt(root: HTMLElement, minutesOfDay: number): void {
  root.style.setProperty('--hud-vignette', vignetteAt(minutesOfDay));
  setHudChips(root, chipModeAt(minutesOfDay));
}
