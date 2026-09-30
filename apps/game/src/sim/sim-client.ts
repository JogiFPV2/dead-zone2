import type { Command, CommandBody } from './protocol.js';

export interface SnapshotMessage {
  tick: number;
  /** Entity buffer, layout in protocol.ts; entity 0 = local player. */
  buf: Float32Array;
}

/**
 * Local adapter between the game and the simulation. Today backed by MockSimClient;
 * later a thin wrapper over createSimWorkerClient(worker) from @deadzone/sim/worker.
 */
export interface SimClient {
  send(cmd: Command): void;
  /** Subscribes to per-tick snapshots. Returns an unsubscribe function. */
  onSnapshot(cb: (snapshot: SnapshotMessage) => void): () => void;
  dispose(): void;
}

/** Stamps command bodies with tick (last seen), playerId and a rising seq. */
export class CommandStamper {
  private seq = 0;
  tick = 0;

  constructor(readonly playerId: number) {}

  stamp(body: CommandBody): Command {
    return { ...body, tick: this.tick, playerId: this.playerId, seq: ++this.seq };
  }
}
