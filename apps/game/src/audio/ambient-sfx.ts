import type { Cue } from './world-sfx.js';
import { GROANS, RAIN, THUNDER, falloff } from './world-sfx.js';

/** Zombies within this distance (tiles) groan now and then. */
export const GROAN_TILES = 14;
/** Mean seconds between groans of one zombie; the crowd as a whole is capped below. */
export const GROAN_EVERY_SEC = 9;
/** Never two groans closer than this (seconds), however many zombies are near. */
export const GROAN_GAP_SEC = 0.7;

/**
 * Idle zombie voices: each nearby zombie groans at random, about every GROAN_EVERY_SEC, with a
 * global gap so a horde murmurs instead of shouting all at once.
 */
export class ZombieVoices {
  private sinceLast = Infinity;

  update(
    dtSec: number,
    zombies: readonly { x: number; z: number }[],
    px: number,
    py: number,
    pick = Math.random,
  ): Cue | undefined {
    this.sinceLast += dtSec;
    if (this.sinceLast < GROAN_GAP_SEC || zombies.length === 0) return undefined;
    // Chance that any of them starts a groan in this frame.
    const p = 1 - Math.pow(1 - Math.min(1, dtSec / GROAN_EVERY_SEC), zombies.length);
    if (pick() >= p) return undefined;
    const z = zombies[Math.floor(pick() * zombies.length)] ?? zombies[0]!;
    const v = falloff(z.x - px, z.z - py, GROAN_TILES) * 0.6;
    if (v <= 0) return undefined;
    this.sinceLast = 0;
    return { id: GROANS[Math.floor(pick() * GROANS.length)] ?? GROANS[0], volume: v };
  }
}

/** In-game ambience loop: rain (by its strength) over night crickets; none on a quiet day. */
export function ambienceLoop(
  rain: number,
  night: boolean,
  snow: number,
): { id: typeof RAIN | 'amb-crickets'; volume: number } | undefined {
  if (rain > 0.02) return { id: RAIN, volume: Math.min(1, 0.35 + rain * 0.65) };
  if (night && snow < 0.5) return { id: 'amb-crickets', volume: 0.6 };
  return undefined;
}

/** Thunder after a lightning flash: delayed like a strike a few hundred metres away. */
export class Thunder {
  private wasFlash = false;
  /** Seconds left until each queued thunder. */
  private pending: number[] = [];

  update(dtSec: number, flash: number, pick = Math.random): Cue | undefined {
    const rising = flash > 0.05 && !this.wasFlash;
    this.wasFlash = flash > 0.05;
    if (rising) this.pending.push(0.6 + pick() * 2.4);
    this.pending = this.pending.map((t) => t - dtSec);
    const due = this.pending.findIndex((t) => t <= 0);
    if (due < 0) return undefined;
    this.pending.splice(due, 1);
    return { id: THUNDER, volume: 0.85 };
  }
}

/** Night for the ambience: the sun below the horizon (daylight factor from the lighting). */
export const isNight = (daylight: number): boolean => daylight < 0.25;
