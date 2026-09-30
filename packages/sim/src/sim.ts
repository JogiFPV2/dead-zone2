import {
  CHUNK_SIZE,
  snapshotByteLength,
  type Command,
  type PlayerId,
  type SimEvent,
  type SimMap,
} from '@deadzone/protocol';
import {
  COMMAND_WINDOW_TICKS,
  DEFAULT_MAX_ENTITIES,
  PLAYER_RADIUS,
  TICKS_PER_SECOND,
  WALK_SPEED_TILES_PER_SECOND,
} from './core/constants.js';
import { bamToRad } from './core/dmath.js';
import { HashWriter } from './core/hash.js';
import { PIPELINE, type SystemContext } from './core/pipeline.js';
import { RNG_STREAMS } from './core/rng.js';
import { attach, createSimWorld, sortedQuery, spawnEntity, type SimWorld } from './core/world.js';
import type { EnqueueResult } from './commands/queue.js';
import { writeRenderSnapshot, renderEntityCount } from './snapshot/render.js';
import { circleOverlaps } from './world/collision.js';
import { TileGrid } from './world/grid.js';

export interface SimOptions {
  seed: number;
  map: SimMap;
  /**
   * Player 0 spawn in tiles (worker: `init.spawn`); default: first free tile centre of chunk
   * (0, 0, 0). Not checked against walls: the caller picks a free tile.
   */
  spawn?: { x: number; y: number; z?: number };
  /** Default WALK_SPEED_TILES_PER_SECOND (3). */
  walkSpeedTilesPerSecond?: number;
  maxEntities?: number;
  commandWindowTicks?: number;
}

export interface PlayerState {
  stableId: number;
  x: number;
  y: number;
  z: number;
  /** BAM, 65536 = 360°. */
  facing: number;
  facingRad: number;
}

export interface Sim {
  /** Index of the next tick to run (= ticks already run). */
  readonly tick: number;
  readonly seed: number;
  /** Validates and queues a command (never throws). */
  enqueue(cmd: Command): EnqueueResult;
  /** Runs exactly one 50 ms tick, synchronously. */
  step(): void;
  /** Render snapshot (protocol layout); writes into `buf` if its size matches. */
  snapshot(buf?: ArrayBuffer): ArrayBuffer;
  /** Bytes needed by `snapshot()` right now (for buffer pools). */
  snapshotByteLength(): number;
  /** xxHash32 of the canonical simulation state (tick, RNG, entities by StableId). */
  hash(): number;
  /** Events since the last drain (e.g. commandRejected). */
  drainEvents(): SimEvent[];
  getPlayer(playerId?: PlayerId): PlayerState | undefined;
  /** Escape hatch for tests and tools; systems' internals, not a stable API. */
  readonly world: SimWorld;
}

function findSpawn(grid: TileGrid): { x: number; y: number } {
  for (let ty = 0; ty < CHUNK_SIZE; ty++) {
    for (let tx = 0; tx < CHUNK_SIZE; tx++) {
      if (!circleOverlaps(grid, 0, tx + 0.5, ty + 0.5, PLAYER_RADIUS))
        return { x: tx + 0.5, y: ty + 0.5 };
    }
  }
  return { x: 0.5, y: 0.5 };
}

export function createSim(opts: SimOptions): Sim {
  const w = createSimWorld({
    seed: opts.seed,
    map: opts.map,
    capacity: opts.maxEntities ?? DEFAULT_MAX_ENTITIES,
    commandWindowTicks: opts.commandWindowTicks ?? COMMAND_WINDOW_TICKS,
  });
  const ctx: SystemContext = { grid: new TileGrid(opts.map) };
  const c = w.c;

  const spawnPlayer = (playerId: PlayerId, x: number, y: number, z: number): number => {
    const eid = spawnEntity(w);
    for (const comp of [
      c.Position,
      c.Velocity,
      c.Facing,
      c.Collider,
      c.MoveIntent,
      c.AimIntent,
      c.MoveStats,
      c.Player,
    ]) {
      attach(w, eid, comp);
    }
    c.Position.x[eid] = Math.fround(x);
    c.Position.y[eid] = Math.fround(y);
    c.Position.z[eid] = z;
    c.Collider.radius[eid] = Math.fround(PLAYER_RADIUS);
    c.MoveStats.speedPerTick[eid] = Math.fround(
      (opts.walkSpeedTilesPerSecond ?? WALK_SPEED_TILES_PER_SECOND) / TICKS_PER_SECOND,
    );
    c.Player.id[eid] = playerId;
    w.players.set(playerId, eid);
    return eid;
  };

  const spawn = opts.spawn ?? findSpawn(ctx.grid);
  spawnPlayer(0, spawn.x, spawn.y, opts.spawn?.z ?? 0);

  const hash = (): number => {
    const h = new HashWriter();
    h.u32(w.tick).u32(w.seed).u32(w.nextStableId);
    for (const name of RNG_STREAMS) for (const word of w.rng[name].state()) h.u32(word);
    const seqs = w.queue.seqState();
    h.u32(seqs.length);
    for (const [pid, seq] of seqs) h.u32(pid).u32(seq);
    const eids = sortedQuery(w, 'hash', []);
    h.u32(eids.length);
    for (const eid of eids) {
      h.u32(c.StableId.value[eid] ?? 0).u32(c.Player.id[eid] ?? 0);
      h.f32(c.Position.x[eid] ?? 0)
        .f32(c.Position.y[eid] ?? 0)
        .f32(c.Position.z[eid] ?? 0);
      h.f32(c.Velocity.x[eid] ?? 0).f32(c.Velocity.y[eid] ?? 0);
      h.u32(c.Facing.angle[eid] ?? 0).f32(c.Collider.radius[eid] ?? 0);
      h.f32(c.MoveIntent.dx[eid] ?? 0).f32(c.MoveIntent.dy[eid] ?? 0);
      h.f32(c.AimIntent.x[eid] ?? 0)
        .f32(c.AimIntent.y[eid] ?? 0)
        .u32(c.AimIntent.active[eid] ?? 0);
      h.f32(c.MoveStats.speedPerTick[eid] ?? 0);
    }
    return h.digest();
  };

  return {
    get tick() {
      return w.tick;
    },
    seed: w.seed,
    world: w,
    enqueue: (cmd) => w.queue.enqueue(cmd, w.tick),
    step() {
      for (const sys of PIPELINE) sys.run(w, ctx);
      w.tick++;
    },
    snapshot: (buf) => writeRenderSnapshot(w, 0, buf),
    snapshotByteLength: () => snapshotByteLength(renderEntityCount(w)),
    hash,
    drainEvents() {
      const ev = w.events;
      w.events = [];
      return ev;
    },
    getPlayer(playerId = 0) {
      const eid = w.players.get(playerId);
      if (eid === undefined) return undefined;
      const facing = c.Facing.angle[eid] ?? 0;
      return {
        stableId: c.StableId.value[eid] ?? 0,
        x: c.Position.x[eid] ?? 0,
        y: c.Position.y[eid] ?? 0,
        z: c.Position.z[eid] ?? 0,
        facing,
        facingRad: bamToRad(facing),
      };
    },
  };
}
