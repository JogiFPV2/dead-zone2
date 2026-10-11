/**
 * Noise circle (HUD v2 spec „Okrąg hałasu”): one ring for the own character's latest noise, from
 * the sim's `playerNoise` events. Pure: the renderer (noise-ring.ts) only draws `sample()`.
 */
import { PLAYER_NOISE_CONTINUOUS, type PlayerNoiseKind } from '@deadzone/protocol';
import type { NoiseDisplay } from '../../settings/schema.js';

export type { NoiseDisplay };
/** „Tylko głośne”: radius from this many metres (run, pry / kick, boarding, glass, shots…). */
export const NOISE_LOUD_MIN_M = 10;

/** Loudness of a sneak footstep (`noise.footsteps.sneak.volume`): tier „cicho”. */
export const SNEAK_STEP_LOUDNESS = 0.1;

export type NoiseTier = 'quiet' | 'mid' | 'loud';
export const noiseTier = (loudness: number): NoiseTier =>
  loudness < 0.3 ? 'quiet' : loudness < 0.8 ? 'mid' : 'loud';

/** Looks per tier: colour, peak stroke / fill alpha, stroke width (screen px). */
export const NOISE_LOOK: Record<
  NoiseTier,
  { color: number; stroke: number; fill: number; widthPx: number }
> = {
  quiet: { color: 0xe4e6e3, stroke: 0.14, fill: 0.03, widthPx: 1.5 },
  mid: { color: 0xf0c06a, stroke: 0.18, fill: 0.04, widthPx: 1.5 },
  loud: { color: 0xe8766c, stroke: 0.22, fill: 0.05, widthPx: 2 },
};
/** Dark underlay under the stroke (readability on light ground). */
export const NOISE_UNDERLAY = { widthPx: 3, alpha: 0.08 };

/** Phase times (ms): enter, hold, fade (loud tier holds and fades longer). */
export const NOISE_ENTER_MS = 180;
export const noiseHoldMs = (t: NoiseTier): number => (t === 'loud' ? 1000 : 600);
export const noiseFadeMs = (t: NoiseTier): number => (t === 'loud' ? 2000 : 1200);
/** Radius change of a refreshed continuous noise (walk → run). */
export const NOISE_RETARGET_MS = 180;

/** Footsteps / engine: refresh the ring instead of drawing a new one. */
const continuous = (k: PlayerNoiseKind): boolean => PLAYER_NOISE_CONTINUOUS.includes(k);
/** Kinds whose ring follows the player (emitted at the player every 0.5 s). */
export const followsPlayer = continuous;

export function showsNoise(display: NoiseDisplay, radiusM: number): boolean {
  if (display === 'off') return false;
  return display === 'loud' ? radiusM >= NOISE_LOUD_MIN_M : radiusM > 0;
}

export interface NoiseEventIn {
  x: number;
  y: number;
  z: number;
  radius: number;
  loudness: number;
  kind: PlayerNoiseKind;
}

export interface NoiseRingVM {
  x: number;
  y: number;
  z: number;
  radiusM: number;
  loudness: number;
  tier: NoiseTier;
  kind: PlayerNoiseKind;
  bornMs: number;
  refreshedMs: number;
  /** Radius before the last refresh (tweened to `radiusM`). */
  fromRadiusM: number;
}

export interface NoiseSample {
  x: number;
  y: number;
  z: number;
  /** Drawn radius (m). */
  radiusM: number;
  tier: NoiseTier;
  /** 0..1 multiplier of the tier's peak alphas. */
  alpha: number;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** When the hold phase ends (the ring starts to fade). */
const holdEnd = (r: NoiseRingVM): number =>
  Math.max(r.bornMs + NOISE_ENTER_MS, r.refreshedMs) + noiseHoldMs(r.tier);
const endMs = (r: NoiseRingVM): number => holdEnd(r) + noiseFadeMs(r.tier);

export class NoiseRingModel {
  ring: NoiseRingVM | undefined;

  /** A `playerNoise` of the own character at `now` (ms); filtered by the setting. */
  push(e: NoiseEventIn, now: number, display: NoiseDisplay): void {
    if (!showsNoise(display, e.radius)) return;
    const cur = this.ring && now < endMs(this.ring) ? this.ring : undefined;
    const tier = noiseTier(e.loudness);
    // A louder ring still holding wins over a quieter newcomer.
    if (cur && cur.loudness > e.loudness && now < holdEnd(cur)) return;
    if (cur && continuous(cur.kind) && continuous(e.kind)) {
      // Next step / engine tick of the same action: renew the hold, no new entry.
      cur.fromRadiusM = this.radiusAt(cur, now);
      Object.assign(cur, { x: e.x, y: e.y, z: e.z, radiusM: e.radius, loudness: e.loudness, tier });
      cur.refreshedMs = now;
      return;
    }
    this.ring = {
      x: e.x,
      y: e.y,
      z: e.z,
      radiusM: e.radius,
      fromRadiusM: e.radius,
      loudness: e.loudness,
      tier,
      kind: e.kind,
      bornMs: now,
      refreshedMs: now,
    };
  }

  /**
   * Own footstep ring from `CharacterView.stepNoiseTiles` (1 tile = 1 m), shown whatever the
   * setting: for SNEAK_REVEAL_MS after `C` switches sneaking on, so the player sees the smaller
   * radius even with „Tylko głośne”. Same faint „cicho” look as a sneak `playerNoise`; standing
   * still (radius 0) draws nothing.
   */
  pushStep(radiusM: number, at: { x: number; y: number; z: number }, now: number): void {
    if (!(radiusM > 0)) return;
    this.push(
      { ...at, radius: radiusM, loudness: SNEAK_STEP_LOUDNESS, kind: 'sneak' },
      now,
      'always',
    );
  }

  /** The setting changed: drop a ring the new setting would not show. */
  setDisplay(display: NoiseDisplay): void {
    if (this.ring && !showsNoise(display, this.ring.radiusM)) this.ring = undefined;
  }

  /**
   * What to draw at `now`; `player` = live position for rings that follow the player. Reduced
   * motion: no radius animation (entry scale, walk → run), the ring appears at once and fades
   * linearly.
   */
  sample(
    now: number,
    reducedMotion = false,
    player?: { x: number; y: number; z: number },
  ): NoiseSample | undefined {
    const r = this.ring;
    if (!r) return undefined;
    if (now >= endMs(r)) {
      this.ring = undefined;
      return undefined;
    }
    const enter = reducedMotion ? 1 : clamp01((now - r.bornMs) / NOISE_ENTER_MS);
    const fadeT = clamp01((now - holdEnd(r)) / noiseFadeMs(r.tier));
    const alpha =
      (reducedMotion ? 1 : easeOut(enter)) * (1 - (reducedMotion ? fadeT : easeIn(fadeT)));
    const base = reducedMotion ? r.radiusM : this.radiusAt(r, now);
    const scale = reducedMotion ? 1 : 0.85 + 0.15 * easeOut(enter);
    const at = player && followsPlayer(r.kind) ? player : r;
    return { x: at.x, y: at.y, z: at.z, radiusM: base * scale, tier: r.tier, alpha };
  }

  private radiusAt(r: NoiseRingVM, now: number): number {
    const t = easeOut(clamp01((now - r.refreshedMs) / NOISE_RETARGET_MS));
    return r.fromRadiusM + (r.radiusM - r.fromRadiusM) * t;
  }
}
