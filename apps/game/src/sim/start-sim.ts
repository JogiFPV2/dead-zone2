import { createSimWorkerClient } from '@deadzone/sim/worker-client';
import SimWorker from '@deadzone/sim/worker?worker';
import type { SimSpawn } from '@deadzone/protocol';
import type { ChunkRange, ChunkSource } from '../world/chunk.js';
import { chunkSourceToSimMapData } from '../world/sim-map.js';
import { WorkerSimClient } from './worker-sim-client.js';

/** Starts the sim Web Worker on a map. Without `spawn` player 0 gets the sim's default tile. */
export function startSimWorker(
  source: ChunkSource,
  range: ChunkRange,
  seed: number,
  spawn?: SimSpawn,
): WorkerSimClient {
  const client = createSimWorkerClient(new SimWorker());
  client.init(seed, chunkSourceToSimMapData(source, range), spawn ? { spawn } : undefined);
  return new WorkerSimClient(client);
}
