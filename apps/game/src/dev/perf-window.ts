/** Rolling frame interval / CPU time window (pure, no DOM). */
export class PerfWindow {
  private readonly frame: Float64Array;
  private readonly cpu: Float64Array;
  private n = 0;
  private i = 0;

  constructor(readonly size = 120) {
    this.frame = new Float64Array(size);
    this.cpu = new Float64Array(size);
  }

  record(frameMs: number, cpuMs: number): void {
    this.frame[this.i] = frameMs;
    this.cpu[this.i] = cpuMs;
    this.i = (this.i + 1) % this.size;
    this.n = Math.min(this.n + 1, this.size);
  }

  report(): { frameMs: number; frameMaxMs: number; cpuMs: number } {
    let f = 0;
    let c = 0;
    let max = 0;
    for (let k = 0; k < this.n; k++) {
      f += this.frame[k]!;
      c += this.cpu[k]!;
      max = Math.max(max, this.frame[k]!);
    }
    const d = Math.max(1, this.n);
    return { frameMs: f / d, frameMaxMs: max, cpuMs: c / d };
  }
}

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  frameMaxMs: number;
  cpuMs: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  chunks: readonly number[];
  wanted: readonly number[];
  pending: number;
  fetching: number;
  dataChunks: number;
  streamBytes: number;
  created: number;
  disposed: number;
  heapMB: number | undefined;
}
