import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { ApiErrorCode } from '@deadzone/protocol';
import { HttpError } from '../errors.js';
import type { SaveValidator, ValidateOptions, ValidatedEnvelope } from './validate.js';

export interface WorkerRequest {
  id: number;
  bytes: Uint8Array;
  opts: ValidateOptions;
}

export type WorkerReply =
  | { id: number; ok: true; result: ValidatedEnvelope }
  | { id: number; ok: false; status: number; code: ApiErrorCode; message: string };

export type { SaveValidator } from './validate.js';

export interface WorkerPoolOptions {
  /** Worker threads; default `availableParallelism() - 1`, at least 1. */
  size?: number;
  /** Per-envelope time budget; the worker is killed and replaced after it. */
  timeoutMs: number;
  /** V8 heap cap per worker (old generation), MiB. */
  maxHeapMb: number;
  /** Waiting validations before new ones get 503. */
  maxQueue?: number;
  /** Test hook: another worker script. */
  workerUrl?: URL;
}

interface Job {
  bytes: Uint8Array;
  opts: ValidateOptions;
  resolve: (v: ValidatedEnvelope) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker | null;
  job: (Job & { id: number; timer: NodeJS.Timeout }) | null;
}

/**
 * A single string bigger than the heap cap aborts the whole process instead of the worker, so the
 * cap must leave room for the decoded state (UTF-16 strings can take 2 bytes per byte, plus the
 * parsed copy).
 */
export const HEAP_PER_STATE_BYTE = 4;
const MIB = 1024 * 1024;

/** Smallest worker heap (MiB) that is safe for `maxStateBytes`. */
export function minHeapMb(maxStateBytes: number): number {
  return Math.ceil((maxStateBytes * HEAP_PER_STATE_BYTE) / MIB);
}

/**
 * Built `.js` in production; from source (tests, `tsx watch`) a small `.mjs` bootstrap loads the
 * TypeScript worker through tsx, because worker threads ignore `--import` loaders on Node 20.
 */
function defaultWorkerUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./validate-worker-dev.mjs', import.meta.url)
    : new URL('./validate-worker.js', import.meta.url);
}

export function createWorkerPool(o: WorkerPoolOptions): SaveValidator {
  const size = Math.max(1, o.size ?? availableParallelism() - 1);
  const maxQueue = o.maxQueue ?? 64;
  const workerUrl = o.workerUrl ?? defaultWorkerUrl();
  const slots: Slot[] = Array.from({ length: size }, () => ({ worker: null, job: null }));
  const queue: Job[] = [];
  let nextId = 1;
  let closed = false;

  function finish(slot: Slot, outcome: { value?: ValidatedEnvelope; error?: Error }): void {
    const job = slot.job;
    if (!job) return;
    clearTimeout(job.timer);
    slot.job = null;
    if (outcome.error) job.reject(outcome.error);
    else job.resolve(outcome.value!);
    pump();
  }

  /** Kills a worker that misbehaved; the next job starts a fresh one. */
  function kill(slot: Slot): void {
    const w = slot.worker;
    slot.worker = null;
    if (w) void w.terminate();
  }

  function spawn(slot: Slot): Worker {
    const w = new Worker(workerUrl, {
      resourceLimits: { maxOldGenerationSizeMb: o.maxHeapMb, maxYoungGenerationSizeMb: 16 },
    });
    w.unref();
    w.on('message', (r: WorkerReply) => {
      if (slot.worker !== w || slot.job?.id !== r.id) return;
      if (r.ok) finish(slot, { value: r.result });
      else finish(slot, { error: new HttpError(r.status, r.code, r.message) });
    });
    w.on('error', (err: Error & { code?: string }) => {
      if (slot.worker !== w) return;
      kill(slot);
      finish(slot, {
        error:
          err.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new HttpError(413, 'payload_too_large', 'state too large to validate')
            : new Error('save validation worker crashed'),
      });
    });
    w.on('exit', () => {
      if (slot.worker !== w) return;
      slot.worker = null;
      finish(slot, { error: new Error('save validation worker exited') });
    });
    return w;
  }

  function pump(): void {
    for (const slot of slots) {
      if (closed || slot.job || queue.length === 0) continue;
      const job = queue.shift()!;
      const id = nextId++;
      const worker = slot.worker ?? (slot.worker = spawn(slot));
      const timer = setTimeout(() => {
        kill(slot);
        finish(slot, { error: new HttpError(422, 'invalid_state', 'save validation timed out') });
      }, o.timeoutMs);
      slot.job = { ...job, id, timer };
      // Copy: the request body may be a pooled Buffer.
      worker.postMessage({
        id,
        bytes: Uint8Array.from(job.bytes),
        opts: job.opts,
      } satisfies WorkerRequest);
    }
  }

  return {
    validate(bytes, opts) {
      if (closed) return Promise.reject(new Error('validator closed'));
      if (o.maxHeapMb < minHeapMb(opts.maxStateBytes)) {
        return Promise.reject(
          new Error(`worker heap ${o.maxHeapMb} MiB is below ${minHeapMb(opts.maxStateBytes)} MiB`),
        );
      }
      if (queue.length >= maxQueue) {
        return Promise.reject(new HttpError(503, 'unavailable', 'server busy, retry later'));
      }
      return new Promise((resolve, reject) => {
        queue.push({ bytes, opts, resolve, reject });
        pump();
      });
    },
    async close() {
      closed = true;
      for (const job of queue.splice(0)) job.reject(new Error('validator closed'));
      await Promise.all(
        slots.map(async (slot) => {
          const w = slot.worker;
          slot.worker = null;
          if (slot.job) {
            clearTimeout(slot.job.timer);
            slot.job.reject(new Error('validator closed'));
            slot.job = null;
          }
          if (w) await w.terminate();
        }),
      );
    },
  };
}
