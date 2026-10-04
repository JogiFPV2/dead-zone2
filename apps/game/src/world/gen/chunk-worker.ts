/// <reference lib="webworker" />
import type { PlanChunkGenerator } from '@deadzone/map/world-source';
import { columnBuffers } from './convert.js';
import { loadGenerator } from './load-plan.js';
import type { FromChunkWorker, ToChunkWorker } from './protocol.js';

/**
 * Chunk worker of a generated map: loads the world plan once (spatial index, no chunks), then
 * answers `chunk` requests with generated columns (layers transferred, zero copy).
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
let gen: PlanChunkGenerator | undefined;
const queue: ToChunkWorker[] = [];
const post = (m: FromChunkWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

function handle(m: ToChunkWorker): void {
  if (m.t !== 'chunk' || !gen) return;
  const t0 = performance.now();
  let col = null;
  try {
    col = gen.column(m.cx, m.cy) ?? null;
  } catch (e) {
    console.error(`chunk ${m.cx},${m.cy}`, e);
  }
  const ms = performance.now() - t0;
  post({ t: 'chunk', id: m.id, col, ms }, col ? columnBuffers(col) : []);
}

scope.addEventListener('message', (e: MessageEvent<ToChunkWorker>) => {
  const m = e.data;
  if (m.t === 'init') {
    const t0 = performance.now();
    loadGenerator(m.spec)
      .then((g) => {
        gen = g;
        const start = g.start();
        post({
          t: 'ready',
          info: {
            id: g.id,
            version: g.version,
            generatorVersion: g.generatorVersion,
            seed: g.seed,
            bounds: g.bounds,
            maxLevel: g.maxLevel,
            start,
            zombies: g.startZombies(start),
            places: g.places(),
            attribution: g.plan.attribution,
            loadMs: performance.now() - t0,
          },
        });
        for (const q of queue.splice(0)) handle(q);
      })
      .catch((err: unknown) =>
        post({ t: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
    return;
  }
  if (!gen) queue.push(m);
  else handle(m);
});
