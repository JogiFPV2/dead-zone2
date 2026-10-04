/// <reference lib="webworker" />
import { startSimWorkerHost, type WorkerPortLike } from '@deadzone/sim/worker-host';
import { loadGenerator } from './load-plan.js';
import type { SimWorldMessage } from './protocol.js';
import { generatorWorldSource } from './sim-world.js';

/**
 * Sim worker of a generated map: the first message (`dz-world`) names the map; the worker loads
 * the same world plan as the chunk worker and starts the sim host on its lazy `WorldSource`.
 * Bridge messages that arrive meanwhile (`init`, inputs) are replayed in order afterwards.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const early: unknown[] = [];
const listeners: ((e: { data: unknown }) => void)[] = [];
let started = false;

scope.addEventListener('message', (e: MessageEvent<unknown>) => {
  const m = e.data as Partial<SimWorldMessage> | undefined;
  if (m && m.kind === 'dz-world' && m.spec) {
    loadGenerator(m.spec)
      .then((gen) => {
        const port: WorkerPortLike = {
          postMessage: (msg, transfer) => scope.postMessage(msg, transfer),
          addEventListener: (_t, fn) => listeners.push(fn),
        };
        startSimWorkerHost(
          port,
          {
            now: () => performance.now(),
            schedule: (fn, ms) => {
              setTimeout(fn, ms);
            },
          },
          { world: generatorWorldSource(gen) },
        );
        started = true;
        for (const d of early.splice(0)) for (const fn of listeners) fn({ data: d });
      })
      .catch((err: unknown) =>
        scope.postMessage({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    return;
  }
  if (!started) early.push(e.data);
  else for (const fn of listeners) fn({ data: e.data });
});
