import {
  decodeVehicleSnapshot,
  type Command,
  type SimEvent,
  type SimViewPatch,
  type SnapshotVehicle,
} from '@deadzone/protocol';
import type { SavedGame, SimWorkerClient } from '@deadzone/sim/worker-client';
import type { SimClient, SnapshotMessage } from './sim-client.js';

/**
 * Adapts the real sim worker client to the game's SimClient. Listeners must copy what they need
 * (SnapshotBuffer, CrowdBuffer do), because the buffer goes back to the worker pool right after.
 */
export class WorkerSimClient implements SimClient {
  private readonly listeners = new Set<(s: SnapshotMessage) => void>();
  private readonly unsubscribe: () => void;
  private readonly vehicleListeners = new Set<(v: SnapshotVehicle[], tick: number) => void>();
  private vehicleTap: (() => void) | undefined;

  /**
   * `worker`: the raw worker, read for the vehicle snapshot block (`snapshot.vehicles`), which
   * `@deadzone/sim/worker-client` does not pass on yet (API gap reported to Symulacja).
   */
  constructor(
    private readonly client: SimWorkerClient,
    worker?: Pick<Worker, 'addEventListener' | 'removeEventListener'>,
  ) {
    if (worker) {
      const tap = (e: MessageEvent): void => {
        const d = e.data as { kind?: string; tick?: number; vehicles?: unknown } | undefined;
        if (d?.kind !== 'snapshot' || !(d.vehicles instanceof ArrayBuffer)) return;
        if (!this.vehicleListeners.size) return;
        const list = decodeVehicleSnapshot(d.vehicles);
        for (const cb of this.vehicleListeners) cb(list, d.tick ?? 0);
      };
      worker.addEventListener('message', tap);
      this.vehicleTap = () => worker.removeEventListener('message', tap);
    }
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

  /** Cars of every snapshot (position, heading, speed, damage), decoded. */
  onVehicles(cb: (vehicles: SnapshotVehicle[], tick: number) => void): () => void {
    this.vehicleListeners.add(cb);
    return () => this.vehicleListeners.delete(cb);
  }

  /** HUD view deltas (only on change; the first one after init is full). */
  onView(cb: (view: SimViewPatch, tick: number) => void): () => void {
    return this.client.onView(cb);
  }

  onEvents(cb: (events: SimEvent[], tick: number) => void): () => void {
    return this.client.onEvents(cb);
  }

  setPaused(paused: boolean): void {
    if (paused) this.client.pause();
    else this.client.resume();
  }

  /** Asks the worker for a save (`exit` on Zapisz i wyjdź); answered even while paused. */
  save(reason: 'manual' | 'exit' = 'manual'): Promise<SavedGame> {
    return this.client.save(reason);
  }

  /** Every save the worker makes (requested, daily autosave, after sleep). */
  onSaved(cb: (save: SavedGame) => void): () => void {
    return this.client.onSaved(cb);
  }

  /** Fatal init error (e.g. invalid content): the sim does not run. */
  onError(cb: (message: string) => void): () => void {
    return this.client.onError(cb);
  }

  dispose(): void {
    this.unsubscribe();
    this.vehicleTap?.();
    this.vehicleListeners.clear();
    this.listeners.clear();
    this.client.dispose();
  }
}
