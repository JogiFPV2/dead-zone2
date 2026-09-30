import { TICK_MS } from './constants.js';

export type SimSpeed = 1 | 2 | 4;

export interface FixedStepLoopOptions {
  /** Runs exactly one simulation tick. */
  step: () => void;
  /** Tick cap per `advance` at ×1; scaled by speed (default 5 → 10 at ×2, 20 at ×4). */
  maxTicksPerAdvanceX1?: number;
}

/**
 * Real-time → tick accumulator owned by the host (worker, server, tests). It is not part of the
 * simulation state: it is never hashed or saved. Speed-up runs more ticks per real second, it
 * never stretches the tick, so ×1, ×2 and ×4 produce identical states for the same commands.
 */
export class FixedStepLoop {
  accumulatorMs = 0;
  private speedX: SimSpeed = 1;
  private pausedFlag = false;
  private readonly step: () => void;
  private readonly maxX1: number;

  constructor(opts: FixedStepLoopOptions) {
    this.step = opts.step;
    this.maxX1 = Math.max(1, Math.floor(opts.maxTicksPerAdvanceX1 ?? 5));
  }

  get speed(): SimSpeed {
    return this.speedX;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  get maxTicksPerAdvance(): number {
    return this.maxX1 * this.speedX;
  }

  setSpeed(x: SimSpeed): void {
    this.speedX = x;
  }

  pause(): void {
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
  }

  /**
   * Feeds elapsed real time and runs the due ticks. Returns the number of ticks run. When the
   * cap is hit, whole ticks left in the accumulator are dropped (no "spiral of death").
   */
  advance(realDeltaMs: number): number {
    if (this.pausedFlag || !(realDeltaMs > 0)) return 0;
    this.accumulatorMs += realDeltaMs * this.speedX;
    const max = this.maxTicksPerAdvance;
    let n = 0;
    while (this.accumulatorMs >= TICK_MS && n < max) {
      this.step();
      this.accumulatorMs -= TICK_MS;
      n++;
    }
    if (this.accumulatorMs >= TICK_MS) this.accumulatorMs %= TICK_MS;
    return n;
  }

  /** Fraction of the next tick already accumulated, in [0, 1). */
  get alpha(): number {
    return this.accumulatorMs / TICK_MS;
  }
}
