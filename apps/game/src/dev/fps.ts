/** Rolling-average FPS meter over the last `windowSize` frame intervals. Pure, no DOM. */
export interface FpsMeter {
  /** Record a frame at `nowMs` (e.g. performance.now()); returns current average fps. */
  tick(nowMs: number): number;
  fps(): number;
}

export function createFpsMeter(windowSize = 60): FpsMeter {
  const intervals = new Float64Array(windowSize);
  let count = 0;
  let index = 0;
  let sum = 0;
  let last: number | undefined;

  const fps = (): number => (count === 0 || sum <= 0 ? 0 : (count * 1000) / sum);

  return {
    tick(nowMs) {
      if (last !== undefined) {
        const dt = nowMs - last;
        sum += dt - (intervals[index] ?? 0);
        intervals[index] = dt;
        index = (index + 1) % windowSize;
        count = Math.min(count + 1, windowSize);
      }
      last = nowMs;
      return fps();
    },
    fps,
  };
}
