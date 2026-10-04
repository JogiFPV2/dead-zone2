import { buildContentBundle, type PackSource } from '@deadzone/content';
import {
  simMapFromData,
  type MainToWorker,
  type SaveReason,
  type SimContentSource,
  type WorkerToMain,
} from '@deadzone/protocol';
import { parseMainToWorker } from '@deadzone/protocol/schema';
import { FixedStepLoop } from '../core/loop.js';
import { createSim, type Sim } from '../sim.js';
import { SaveError } from '../save/save.js';

/** Minimal structural view of a worker global / MessagePort (no DOM types in sim). */
export interface WorkerPortLike {
  postMessage(message: WorkerToMain, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** Real-time source injected by the entry module (performance.now + setTimeout in a worker). */
export interface HostClock {
  now(): number;
  schedule(fn: () => void, delayMs: number): void;
}

export interface WorkerHostOptions {
  /** Polling interval of the real-time loop (docs: ~4 ms). */
  intervalMs?: number;
  /** Max snapshot buffers kept for reuse. */
  poolSize?: number;
}

export interface WorkerHost {
  readonly sim: Sim | undefined;
  readonly loop: FixedStepLoop | undefined;
  /** Buffers currently available for reuse (returned by main via `release`). */
  readonly pooledBuffers: number;
  /** Messages dropped because they failed validation or arrived before `init`. */
  readonly droppedMessages: number;
  /** Runs one iteration of the real-time loop (normally driven by `clock.schedule`). */
  pump(): void;
  dispose(): void;
}

/**
 * Worker side of the sim bridge: validates messages (zod), runs the fixed-step loop against real
 * time and posts one snapshot per batch of ticks, transferring pooled ArrayBuffers.
 */
export function startSimWorkerHost(
  port: WorkerPortLike,
  clock: HostClock,
  opts: WorkerHostOptions = {},
): WorkerHost {
  const intervalMs = opts.intervalMs ?? 4;
  const poolSize = opts.poolSize ?? 4;
  const pool: ArrayBuffer[] = [];
  let sim: Sim | undefined;
  let loop: FixedStepLoop | undefined;
  let last = clock.now();
  let running = true;
  let dropped = 0;

  const acquire = (bytes: number): ArrayBuffer | undefined => {
    for (let i = pool.length - 1; i >= 0; i--) {
      const b = pool[i];
      if (b?.byteLength === bytes) {
        pool.splice(i, 1);
        return b;
      }
    }
    return undefined;
  };

  const postSnapshot = (): void => {
    if (!sim) return;
    const buf = sim.snapshot(acquire(sim.snapshotByteLength()));
    if (sim.vehicleSnapshotByteLength() > 0) {
      const vehicles = sim.vehicleSnapshot();
      port.postMessage({ kind: 'snapshot', tick: sim.tick, buf, vehicles }, [buf, vehicles]);
    } else port.postMessage({ kind: 'snapshot', tick: sim.tick, buf }, [buf]);
    const view = sim.drainView();
    if (view) port.postMessage({ kind: 'view', tick: sim.tick, view }, []);
    const events = sim.drainEvents();
    if (events.length > 0) port.postMessage({ kind: 'events', tick: sim.tick, events }, []);
    // Autosave once per game day and after an uninterrupted sleep.
    if (events.some((e) => e.type === 'sleepSaved')) postSave(0, 'sleep');
    else if (events.some((e) => e.type === 'dayPassed')) postSave(0, 'autosave');
  };

  const postSave = (requestId: number, reason: SaveReason): void => {
    if (!sim) return;
    const bytes = sim.save();
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    port.postMessage(
      { kind: 'saved', requestId, reason, tick: sim.tick, day: sim.gameTime().day, buf },
      [buf],
    );
  };

  // Speed-up is forced back to ×1 while the sim reports a threat (zombie chasing or nearby).
  const enforceSpeedLock = (): void => {
    if (sim && loop && loop.speed > 1 && sim.fastForwardBlocked()) loop.setSpeed(1);
  };

  const handle = (msg: MainToWorker): void => {
    if (msg.kind === 'init') {
      let content;
      try {
        content = msg.content ? buildContent(msg.content) : undefined;
      } catch (e) {
        port.postMessage(
          { kind: 'error', message: e instanceof Error ? e.message : String(e) },
          [],
        );
        return;
      }
      let s: Sim;
      try {
        s = createSim({
          seed: msg.seed,
          map: simMapFromData(msg.map),
          ...(msg.spawn ? { spawn: msg.spawn } : {}),
          ...(msg.zombies ? { spawnZombies: msg.zombies } : {}),
          ...(msg.animals ? { spawnAnimals: msg.animals } : {}),
          ...(msg.vehicles ? { spawnVehicles: msg.vehicles } : {}),
          ...(msg.populateAnimals ? { populateAnimals: msg.populateAnimals } : {}),
          content,
          dev: msg.dev ?? false,
          floorLoot: msg.floorLoot ?? true,
          ...(msg.save ? { load: new Uint8Array(msg.save) } : {}),
          ...(msg.character && !msg.save ? { character: msg.character } : {}),
        });
      } catch (e) {
        // A bad save (or character) must not kill the worker: report it with the save error code.
        port.postMessage(
          {
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
            ...(e instanceof SaveError ? { code: e.code } : {}),
          },
          [],
        );
        return;
      }
      sim = s;
      loop = new FixedStepLoop({ step: () => s.step() });
      // A save resumes at the speed-up it was made with (the sim measures real time with it).
      if (s.timeScale() !== 1) loop.setSpeed(s.timeScale());
      last = clock.now();
      port.postMessage({ kind: 'ready', tick: s.tick }, []);
      postSnapshot();
      return;
    }
    if (msg.kind === 'release') {
      if (pool.length < poolSize && msg.buf.byteLength > 0) pool.push(msg.buf);
      return;
    }
    if (!sim || !loop) {
      dropped++;
      return;
    }
    switch (msg.kind) {
      case 'cmd':
        if (!sim.enqueue(msg.cmd).ok) dropped++;
        break;
      case 'save':
        postSave(msg.requestId, msg.reason ?? 'manual');
        break;
      case 'pause':
        loop.pause();
        break;
      case 'resume':
        last = clock.now();
        loop.resume();
        break;
      case 'speed':
        loop.setSpeed(msg.x);
        enforceSpeedLock();
        break;
    }
  };

  port.addEventListener('message', (event) => {
    if (!running) return;
    const parsed = parseMainToWorker(event.data);
    if (parsed.ok) handle(parsed.value);
    else dropped++;
  });

  const pump = (): void => {
    const now = clock.now();
    const dt = now - last;
    last = now;
    if (loop && loop.advance(dt) > 0) {
      enforceSpeedLock();
      postSnapshot();
    }
  };

  const tickLoop = (): void => {
    if (!running) return;
    pump();
    clock.schedule(tickLoop, intervalMs);
  };
  clock.schedule(tickLoop, intervalMs);

  return {
    get sim() {
      return sim;
    },
    get loop() {
      return loop;
    },
    get pooledBuffers() {
      return pool.length;
    },
    get droppedMessages() {
      return dropped;
    },
    pump,
    dispose() {
      running = false;
    },
  };
}

/** Validates the packs and builds the bundle (zod runs here, in the worker, never on main). */
function buildContent(src: SimContentSource) {
  const packs: PackSource[] = src.packs.map((p) => ({ dir: p.dir, files: [...p.files] }));
  return buildContentBundle(packs);
}
