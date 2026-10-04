import type { CharacterSpec, SimContentSource, SimSpawn } from '@deadzone/protocol';
import { pickZombieSpawns } from '../world/zombie-spawns.js';
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
  /** Places START_ZOMBIES zombies around the map, away from this point (player start). */
  zombiesAwayFrom?: { x: number; y: number; z?: number } | undefined;
  /** New world: this many animals spread over the map by habitat (sim `populateAnimals`). */
  populateAnimals?: number | undefined;
  /** New game: the creator's character (`init({ character })` → `newCharacter`). */
  character?: CharacterSpec | undefined;
  /** Restores this save (the character's slot) instead of a new world. */
  save?: ArrayBuffer | undefined;
  /** Uncaught worker error (e.g. a save that no longer loads). */
  onWorkerError?: ((message: string) => void) | undefined;
}

/** Starts the sim Web Worker on a map. */
export function startSimWorker(
  source: ChunkSource,
  range: ChunkRange,
  seed: number,
  opts: StartSimOptions = {},
): WorkerSimClient {
  const worker = new SimWorker();
  if (opts.onWorkerError) {
    const report = opts.onWorkerError;
    worker.addEventListener('error', (e: ErrorEvent) => report(e.message || 'błąd symulacji'));
  }
  const client = createSimWorkerClient(worker);
  const sim = new WorkerSimClient(client);
  const map = chunkSourceToSimMapData(source, range);
  const zombies = opts.zombiesAwayFrom ? pickZombieSpawns(map, opts.zombiesAwayFrom) : [];
  client.init(seed, map, {
    ...(opts.spawn ? { spawn: opts.spawn } : {}),
    ...(opts.content ? { content: opts.content } : {}),
    ...(opts.dev ? { dev: true } : {}),
    ...(zombies.length ? { zombies } : {}),
    ...(opts.populateAnimals && !opts.save ? { populateAnimals: opts.populateAnimals } : {}),
    ...(opts.character ? { character: opts.character } : {}),
    // A copy: the slot's buffer stays intact if the worker takes (transfers) it.
    ...(opts.save ? { save: opts.save.slice(0) } : {}),
  });
  return sim;
}
