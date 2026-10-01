import type { Command, CommandHeader } from '@deadzone/protocol';

/** Command without the header (tick, playerId, seq are stamped by CommandStamper). */
type Body<C> = C extends Command ? Omit<C, keyof CommandHeader> : never;
export type CommandBody = Body<Command>;

export interface SnapshotMessage {
  tick: number;
  /** Entity buffer, layout in @deadzone/protocol (snapshot.ts); entity 0 = local player. */
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
  /** Stops / restarts ticking (single-player pause menu): no ticks, no game time. */
  setPaused(paused: boolean): void;
  /** Singleplayer speed-up ×1/×2/×4 (worker loop + `setTimeScale`); absent = not supported. */
  setSpeed?(x: 1 | 2 | 4): void;
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
