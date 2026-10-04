import type { SimEvent } from '@deadzone/protocol';
import { CHUNK_SIZE } from '../chunk.js';
import { LOD_NEAR, type StreamConfig } from './rings.js';

/** Upper bound of `setInterest.radiusChunks` (protocol schema: 0..16). */
export const MAX_INTEREST_RADIUS = 16;

export interface Interest {
  cx: number;
  cy: number;
  radiusChunks: number;
}

/**
 * Area of interest for the sim (docs/sim-architecture.md 9.24): the streamer's near ring around
 * the camera target (world X / Z = sim x, y). The near radius follows the „Zasięg widzenia”
 * preset (and covers small authored maps whole), clamped to 0..16; 0 clears the interest.
 */
export function interestFor(target: { x: number; y: number }, cfg: StreamConfig): Interest {
  const r = Math.max(0, Math.min(MAX_INTEREST_RADIUS, Math.floor(cfg.radii[LOD_NEAR])));
  return {
    cx: Math.floor(target.x / CHUNK_SIZE),
    cy: Math.floor(target.y / CHUNK_SIZE),
    radiusChunks: r,
  };
}

/**
 * Keeps the sim in sync with the client streamer:
 * - sends `setInterest` only when the chunk or the radius changes (0 = clear, sent once);
 * - `chunkChanged` events (opening / object / loot) rebuild that chunk (`invalidate`), coalesced
 *   per frame (one rebuild per chunk, whatever the level or reason).
 */
export class SimStreamSync {
  private last: Interest | undefined;
  private readonly changed = new Map<string, { cx: number; cy: number }>();

  constructor(
    private readonly send: (i: Interest) => void,
    private readonly invalidate: (cx: number, cy: number) => void,
  ) {}

  /** Per frame with the camera target (sim x, y) and the streamer's current config. */
  update(target: { x: number; y: number }, cfg: StreamConfig): void {
    const next = interestFor(target, cfg);
    const l = this.last;
    const same =
      l !== undefined &&
      l.radiusChunks === next.radiusChunks &&
      (next.radiusChunks === 0 || (l.cx === next.cx && l.cy === next.cy));
    if (!same) {
      this.last = next;
      this.send(next);
    }
    this.flush();
  }

  /** Sim events: remembers `chunkChanged` chunks for the next `flush`. */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'chunkChanged') this.changed.set(`${e.cx},${e.cy}`, { cx: e.cx, cy: e.cy });
    }
  }

  /** Rebuilds the chunks changed since the last frame. */
  flush(): void {
    if (this.changed.size === 0) return;
    for (const { cx, cy } of this.changed.values()) this.invalidate(cx, cy);
    this.changed.clear();
  }
}
