import type { Command, SimEvent, SimViewPatch } from '@deadzone/protocol';
import type { SimWorkerClient } from '@deadzone/sim/worker-client';
import type { SimClient, SnapshotMessage } from './sim-client.js';

/**
 * Adapts the real sim worker client to the game's SimClient. Listeners must copy what they need
 * (SnapshotBuffer, CrowdBuffer do), because the buffer goes back to the worker pool right after.
 */
export class WorkerSimClient implements SimClient {
  private readonly listeners = new Set<(s: SnapshotMessage) => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly client: SimWorkerClient) {
    this.unsubscribe = client.onSnapshot(({ tick, buf }) => {
      const snapshot = { tick, buf: new Float32Array(buf) };
      for (const cb of this.listeners) cb(snapshot);
      client.release(buf);
    });
  }

  send(cmd: Command): void {
    this.client.send(cmd);
  }

  /** Loop speed and the sim's real-time measure (`setTimeScale`, sleep save) together. */
  setSpeed(x: 1 | 2 | 4): void {
    this.client.setSpeed(x);
  }

  onSnapshot(cb: (snapshot: SnapshotMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** HUD view deltas (only on change; the first one after init is full). */
  onView(cb: (view: SimViewPatch, tick: number) => void): () => void {
    return this.client.onView(cb);
  }

  onEvents(cb: (events: SimEvent[], tick: number) => void): () => void {
    return this.client.onEvents(cb);
  }

  /** Fatal init error (e.g. invalid content): the sim does not run. */
  onError(cb: (message: string) => void): () => void {
    return this.client.onError(cb);
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
    this.client.dispose();
  }
}
