/** Rolling CPU timings (ms) of the per-frame entity update and render submit. Pure, no DOM. */
export interface FrameSample {
  updateMs: number;
  renderMs: number;
}

export interface BenchReport {
  frames: number;
  updateMs: number;
  renderMs: number;
  totalMs: number;
  /** Worst total over the window. */
  maxMs: number;
}

export class FrameBench {
  private readonly update: Float64Array;
  private readonly render: Float64Array;
  private n = 0;
  private i = 0;
  private total = 0;

  constructor(readonly windowSize = 120) {
    this.update = new Float64Array(windowSize);
    this.render = new Float64Array(windowSize);
  }

  /** Frames recorded so far (not capped by the window). */
  get frames(): number {
    return this.total;
  }

  record({ updateMs, renderMs }: FrameSample): void {
    this.update[this.i] = updateMs;
    this.render[this.i] = renderMs;
    this.i = (this.i + 1) % this.windowSize;
    this.n = Math.min(this.n + 1, this.windowSize);
    this.total++;
  }

  report(): BenchReport {
    let u = 0;
    let r = 0;
    let max = 0;
    for (let k = 0; k < this.n; k++) {
      const uk = this.update[k] ?? 0;
      const rk = this.render[k] ?? 0;
      u += uk;
      r += rk;
      max = Math.max(max, uk + rk);
    }
    const d = Math.max(this.n, 1);
    return { frames: this.n, updateMs: u / d, renderMs: r / d, totalMs: (u + r) / d, maxMs: max };
  }
}

export const formatBench = (entities: number, r: BenchReport): string =>
  `${entities} entities · cpu ${r.totalMs.toFixed(2)} ms/frame ` +
  `(update ${r.updateMs.toFixed(2)} + render ${r.renderMs.toFixed(2)}, max ${r.maxMs.toFixed(2)})`;
