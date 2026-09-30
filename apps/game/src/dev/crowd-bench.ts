import type { WebGLRenderer } from 'three';
import { FrameBench, formatBench, type FrameSample } from './frame-bench.js';

const WARMUP_FRAMES = 30;
const LOG_AFTER_FRAMES = 150;

/** Dev-only: rolls frame CPU timings, logs one summary to the console, feeds the overlay. */
export function createCrowdBench(entities: () => number) {
  const bench = new FrameBench(LOG_AFTER_FRAMES - WARMUP_FRAMES);
  let frames = 0;
  let logged = false;
  return {
    record: (sample: FrameSample, renderer: WebGLRenderer): void => {
      if (++frames <= WARMUP_FRAMES) return;
      bench.record(sample);
      if (!logged && frames >= LOG_AFTER_FRAMES) {
        logged = true;
        const calls = renderer.info.render.calls;
        console.info(
          `[crowd-bench] ${formatBench(entities(), bench.report())} · ${calls} draw calls`,
        );
      }
    },
    line: (): string => formatBench(entities(), bench.report()),
  };
}
