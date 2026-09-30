import { createSimWorkerClient } from '@deadzone/sim/worker-client';
import SimWorker from '@deadzone/sim/worker?worker';
import type { ChunkRange, ChunkSource } from '../world/chunk.js';
import { chunkSourceToSimMapData } from '../world/sim-map.js';
import { WorkerSimClient } from './worker-sim-client.js';

/** Starts the sim Web Worker on a map. Player 0 spawns on the sim's default tile. */
export function startSimWorker(
  source: ChunkSource,
  range: ChunkRange,
  seed: number,
): WorkerSimClient {
  const client = createSimWorkerClient(new SimWorker());
  client.init(seed, chunkSourceToSimMapData(source, range));
  return new WorkerSimClient(client);
}
