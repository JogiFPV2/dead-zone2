/**
 * Per-section CPU time of the frame loop (dev perf, `?perf`): `start()` at the top of the frame,
 * `mark(name)` after each section, `end()` at the bottom. Rolling window of `size` frames; pure.
 */
export class FrameSections {
  private readonly rows = new Map<string, Float64Array>();
  private readonly total: Float64Array;
  private t = 0;
  private t0 = 0;
  private i = 0;
  private n = 0;
  private readonly cur = new Map<string, number>();

  constructor(
    readonly size = 600,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.total = new Float64Array(size);
  }

  start(): void {
    this.t0 = this.t = this.now();
    this.cur.clear();
  }

  mark(name: string): void {
    const t = this.now();
    this.cur.set(name, (this.cur.get(name) ?? 0) + t - this.t);
    this.t = t;
  }

  end(): void {
    for (const [k, v] of this.cur) {
      let r = this.rows.get(k);
      if (!r) this.rows.set(k, (r = new Float64Array(this.size)));
      r[this.i] = v;
    }
    for (const [k, r] of this.rows) if (!this.cur.has(k)) r[this.i] = 0;
    this.total[this.i] = this.now() - this.t0;
    this.i = (this.i + 1) % this.size;
    this.n = Math.min(this.n + 1, this.size);
  }

  /** Mean / p50 / p95 / max (ms) per section and for the whole frame, over the window. */
  report(): Record<string, { mean: number; p50: number; p95: number; max: number }> {
    const stat = (a: Float64Array) => {
      const v = Array.from(a.subarray(0, this.n)).sort((x, y) => x - y);
      const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;
      const mean = v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
      return { mean, p50: q(0.5), p95: q(0.95), max: v[v.length - 1] ?? 0 };
    };
    const out: Record<string, { mean: number; p50: number; p95: number; max: number }> = {};
    for (const [k, r] of this.rows) out[k] = stat(r);
    out.total = stat(this.total);
    return out;
  }

  reset(): void {
    this.i = 0;
    this.n = 0;
    this.rows.clear();
  }
}
