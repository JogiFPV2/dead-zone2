import type { SimContentSource, SimSpawn } from '@deadzone/protocol';
import { createSimWorkerClient } from '@deadzone/sim/worker-client';
import SimWorker from '@deadzone/sim/worker?worker';
import type { ChunkRange, ChunkSource } from '../world/chunk.js';
import { chunkSourceToSimMapData } from '../world/sim-map.js';
import { WorkerSimClient } from './worker-sim-client.js';

export interface StartSimOptions {
  /** Player 0 spawn; omitted = the sim's default tile. */
  spawn?: SimSpawn | undefined;
  /** Content packs (survival: clock, stats, moodles, wounds); omitted = movement only. */
  content?: SimContentSource | undefined;
  /** Enables debug commands (`debugWound`, `debugStat`). */
  dev?: boolean;
}

/** Starts the sim Web Worker on a map. */
export function startSimWorker(
  source: ChunkSource,
  range: ChunkRange,
  seed: number,
  opts: StartSimOptions = {},
): WorkerSimClient {
  const client = createSimWorkerClient(new SimWorker());
  const sim = new WorkerSimClient(client);
  client.init(seed, chunkSourceToSimMapData(source, range), {
    ...(opts.spawn ? { spawn: opts.spawn } : {}),
    ...(opts.content ? { content: opts.content } : {}),
    ...(opts.dev ? { dev: true } : {}),
  });
  return sim;
}
