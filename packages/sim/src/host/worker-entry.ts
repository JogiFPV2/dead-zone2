/**
 * Web Worker entry (`@deadzone/sim/worker`). The only module in packages/sim allowed to touch
 * real-time globals (ESLint exempts this file). Types are structural, so the package still
 * compiles without the DOM / WebWorker libs.
 */
import { startSimWorkerHost, type WorkerPortLike } from './worker-host.js';

interface WorkerGlobalLike extends WorkerPortLike {
  setTimeout(fn: () => void, delayMs: number): unknown;
  performance: { now(): number };
}

const scope = globalThis as unknown as WorkerGlobalLike;

startSimWorkerHost(scope, {
  now: () => scope.performance.now(),
  schedule: (fn, delayMs) => {
    scope.setTimeout(fn, delayMs);
  },
});
