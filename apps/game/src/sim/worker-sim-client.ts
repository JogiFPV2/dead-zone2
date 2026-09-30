import type { Command } from '@deadzone/protocol';
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

  onSnapshot(cb: (snapshot: SnapshotMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
    this.client.dispose();
  }
}
