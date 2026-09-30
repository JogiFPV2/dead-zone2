// TEMPORARY STUB: replace with createSimWorkerClient(worker) from @deadzone/sim/worker
// once the simulation API lands. Runs on the main thread at a fixed 20 Hz, no collisions.
import { MOCK_TICK_MS, stepMockPlayer, type FloorBounds, type MockInput } from './mock-step.js';
import type { Command, WorkerToMain } from './protocol.js';
import type { SimClient, SnapshotMessage } from './sim-client.js';
import { writeEntities, type EntityState } from './snapshot.js';

export class MockSimClient implements SimClient {
  private tick = 0;
  private player: EntityState;
  private readonly input: MockInput = { dx: 0, dy: 0, aim: undefined };
  private readonly listeners = new Set<(s: SnapshotMessage) => void>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly bounds: FloorBounds,
    spawn: { x: number; y: number },
    playerId = 1,
  ) {
    this.player = { id: playerId, x: spawn.x, y: spawn.y, z: 0, facing: 0 };
    this.timer = setInterval(() => this.step(), MOCK_TICK_MS);
  }

  send(cmd: Command): void {
    if (cmd.playerId !== this.player.id) return;
    if (cmd.type === 'move') {
      this.input.dx = cmd.dx;
      this.input.dy = cmd.dy;
    } else {
      this.input.aim = { x: cmd.x, y: cmd.y };
    }
  }

  onSnapshot(cb: (snapshot: SnapshotMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.listeners.clear();
  }

  private step(): void {
    this.player = stepMockPlayer(this.player, this.input, MOCK_TICK_MS / 1000, this.bounds);
    this.tick++;
    // Same wire shape the real worker will post.
    const msg: Extract<WorkerToMain, { kind: 'snapshot' }> = {
      kind: 'snapshot',
      tick: this.tick,
      buf: writeEntities([this.player]).buffer,
    };
    const snapshot = { tick: msg.tick, buf: new Float32Array(msg.buf) };
    for (const cb of this.listeners) cb(snapshot);
  }
}
