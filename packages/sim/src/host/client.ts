import type {
  Command,
  MainToWorker,
  PlayerId,
  SimMapData,
  SimSpeed,
  WorkerToMain,
} from '@deadzone/protocol';

/** Structural subset of `Worker` (a real DOM Worker is assignable to it). */
export interface SimWorkerLike {
  postMessage(message: MainToWorker, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
}

export interface SimSnapshotMessage {
  tick: number;
  /** Owned by the receiver; give it back with `release()` when no longer rendered. */
  buf: ArrayBuffer;
}

export interface SimWorkerClient {
  init(seed: number, map: SimMapData): void;
  /** Sends a fully formed command (tick, playerId, seq chosen by the caller). */
  send(cmd: Command): void;
  /** Held movement for the local player; fills tick/playerId/seq. */
  move(dx: number, dy: number): void;
  /** Aim at a world point (tiles) for the local player. */
  aim(x: number, y: number): void;
  pause(): void;
  resume(): void;
  setSpeed(x: SimSpeed): void;
  onReady(cb: (tick: number) => void): () => void;
  onSnapshot(cb: (snapshot: SimSnapshotMessage) => void): () => void;
  /** Returns a snapshot buffer to the worker pool (transferred, so it becomes detached here). */
  release(buf: ArrayBuffer): void;
  /** Latest tick seen in a `ready` or `snapshot` message. */
  readonly tick: number;
  dispose(): void;
}

export function createSimWorkerClient(
  worker: SimWorkerLike,
  opts: { playerId?: PlayerId } = {},
): SimWorkerClient {
  const playerId = opts.playerId ?? 0;
  const readyCbs = new Set<(tick: number) => void>();
  const snapCbs = new Set<(s: SimSnapshotMessage) => void>();
  let tick = 0;
  let seq = 0;

  const post = (msg: MainToWorker, transfer: ArrayBuffer[] = []): void =>
    worker.postMessage(msg, transfer);

  const listener = (event: { data: unknown }): void => {
    const msg = event.data as WorkerToMain;
    if (msg.kind === 'ready') {
      tick = msg.tick;
      for (const cb of readyCbs) cb(msg.tick);
    } else if (msg.kind === 'snapshot') {
      tick = msg.tick;
      for (const cb of snapCbs) cb({ tick: msg.tick, buf: msg.buf });
    }
  };
  worker.addEventListener('message', listener);

  // The worker moves commands for past ticks to its current tick, so the last seen tick is safe.
  const nextHeader = () => ({ tick, playerId, seq: seq++ });

  return {
    init: (seed, map) => post({ kind: 'init', seed, map }),
    send: (cmd) => post({ kind: 'cmd', cmd }),
    move: (dx, dy) => post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'move', dx, dy } }),
    aim: (x, y) => post({ kind: 'cmd', cmd: { ...nextHeader(), type: 'aim', x, y } }),
    pause: () => post({ kind: 'pause' }),
    resume: () => post({ kind: 'resume' }),
    setSpeed: (x) => post({ kind: 'speed', x }),
    onReady(cb) {
      readyCbs.add(cb);
      return () => readyCbs.delete(cb);
    },
    onSnapshot(cb) {
      snapCbs.add(cb);
      return () => snapCbs.delete(cb);
    },
    release(buf) {
      if (buf.byteLength > 0) post({ kind: 'release', buf }, [buf]);
    },
    get tick() {
      return tick;
    },
    dispose() {
      worker.removeEventListener('message', listener);
      readyCbs.clear();
      snapCbs.clear();
      worker.terminate?.();
    },
  };
}
