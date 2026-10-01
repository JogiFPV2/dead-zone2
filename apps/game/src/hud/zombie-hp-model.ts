/** Health → bar colour band (approved mockup): green > 60 %, yellow 30–60 %, red < 30 %. */
export type HpBand = 'ok' | 'warn' | 'low';

export function hpBand(hpPct: number): HpBand {
  if (hpPct > 0.6) return 'ok';
  if (hpPct >= 0.3) return 'warn';
  return 'low';
}

/** Segments of the target bubble bar. */
export const HP_SEGMENTS = 6;

/** Lit segments of the target bubble (at least one while alive). */
export function hpSegments(hpPct: number): number {
  return Math.max(1, Math.min(HP_SEGMENTS, Math.ceil(hpPct * HP_SEGMENTS - 1e-6)));
}

/** Below this the zombie counts as wounded (float noise from the sim stays "healthy"). */
const WOUNDED_BELOW = 0.999;

export type HpView = 'none' | 'bar' | 'target';

/**
 * What to draw over one zombie: the target always gets the bubble; others get the small bar only
 * when wounded and „Pokazuj życie zombie” is on. Dead zombies get nothing.
 */
export function hpView(
  hpPct: number,
  dead: boolean,
  targeted: boolean,
  opts: { showWounded: boolean; targeting: boolean },
): HpView {
  if (dead || hpPct <= 0) return 'none';
  if (targeted && opts.targeting) return 'target';
  if (opts.showWounded && hpPct < WOUNDED_BELOW) return 'bar';
  return 'none';
}

/**
 * Picks the zombie under the cursor: nearest to the floor point (`px`, `pz`) within `radius`
 * tiles, from interleaved samples (x, z at `stride` offsets 0 and 1). Returns the index or -1.
 */
export function pickNearest(
  samples: ArrayLike<number>,
  count: number,
  stride: number,
  px: number,
  pz: number,
  radius: number,
  skip?: (i: number) => boolean,
): number {
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i < count; i++) {
    if (skip?.(i)) continue;
    const dx = (samples[i * stride] ?? 0) - px;
    const dz = (samples[i * stride + 1] ?? 0) - pz;
    const d = dx * dx + dz * dz;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
