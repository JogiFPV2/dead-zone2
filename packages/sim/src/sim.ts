import {
  CHUNK_SIZE,
  snapshotByteLength,
  type Command,
  type PlayerId,
  type SimEvent,
  type SimMap,
  type SimViewPatch,
  type WoundView,
} from '@deadzone/protocol';
import { compileContent, type SimContent } from './content/adapter.js';
import { dayOf, gameMinuteAt, minuteOfDay, type ClockStart } from './core/clock.js';
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
import { ViewTracker, woundViews } from './snapshot/views.js';
import { VITAL_STATS, createSurvivalWorld, initVitals, type VitalStat } from './survival/state.js';
import { DEFAULT_AMBIENT_C } from './systems/survival.js';
import { threatNearby } from './systems/sleep.js';
import type { MinuteTicks } from './systems/clock.js';
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
  /**
   * Content (a `ContentBundle` from packages/content, or any object with these fields). Without
   * it the sim runs movement only: no clock-driven survival, moodles or health.
   */
  content?: SimContent | undefined;
  /** Allows debug commands (`debugWound`, `debugStat`). Default false. */
  dev?: boolean | undefined;
  /** Game clock start; default day 1, 09:00. */
  clockStart?: ClockStart | undefined;
  /** Ambient temperature in °C until weather exists; default 20 (comfortable). */
  ambientTemperatureC?: number | undefined;
}

export interface GameTime {
  /** Absolute game minute (0 = day 1, 00:00). */
  minute: number;
  day: number;
  minuteOfDay: number;
}

/** Read-only survival state of a player (tests, tools, death screen). */
export interface PlayerSurvival {
  alive: boolean;
  sleeping: boolean;
  /** Zombie virus (hidden from the player in the UI). */
  infected: boolean;
  stats: Record<VitalStat, number>;
  /** Visible moodles only (level ≥ 1), by content id. */
  moodles: Record<string, number>;
  wounds: WoundView[];
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
  /** Undefined without content or for unknown players. */
  getSurvival(playerId?: PlayerId): PlayerSurvival | undefined;
  /** Game time of the last executed tick (tick 0 before the first step). */
  gameTime(): GameTime;
  /** Speed-up must be ×1 now (threat nearby). Hook for Stage 4; always false for now. */
  fastForwardBlocked(): boolean;
  /** UI view delta for player 0 since the last call (undefined when nothing changed). */
  drainView(): SimViewPatch | undefined;
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
  const content = opts.content;
  const w = createSimWorld({
    seed: opts.seed,
    map: opts.map,
    capacity: opts.maxEntities ?? DEFAULT_MAX_ENTITIES,
    commandWindowTicks: opts.commandWindowTicks ?? COMMAND_WINDOW_TICKS,
    dayLengthMinutes: opts.content?.worldSettings.dayLengthMinutes,
    clockStart: opts.clockStart,
    dev: opts.dev,
    survival: content
      ? (clock) =>
          createSurvivalWorld(
            compileContent(content),
            opts.maxEntities ?? DEFAULT_MAX_ENTITIES,
            gameMinuteAt(clock, 0),
          )
      : undefined,
  });
  const minutes: MinuteTicks = { first: 0, count: 0 };
  const ctx: SystemContext = {
    grid: new TileGrid(opts.map),
    minutes,
    ambientC: opts.ambientTemperatureC ?? DEFAULT_AMBIENT_C,
  };
  const views = new ViewTracker(0);
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
    if (w.survival) initVitals(w.survival, eid);
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
    const s = w.survival;
    if (s) {
      // Survival section (absent without content, so movement-only golden hashes stay valid).
      h.u32(w.clock.ticksPerDay).u32(w.clock.startMinute).u32(s.lastMinute).u32(s.nextWoundId);
      h.u32(s.content.moodles.length);
      const players = sortedQuery(w, 'players', [c.Player]);
      h.u32(players.length);
      for (const eid of players) {
        const sid = c.StableId.value[eid] ?? 0;
        h.u32(sid);
        for (const stat of VITAL_STATS) h.f32(s.vitals[stat][eid] ?? 0);
        h.f32(s.kcal[eid] ?? 0);
        h.u32(s.dead[eid] ?? 0).u32(s.cause[eid] ?? 0);
        h.u32(s.asleep[eid] ?? 0).u32(s.sleepStart[eid] ?? 0);
        h.u32(s.virus[eid] ?? 0)
          .u32(s.virusStart[eid] ?? 0)
          .u32(s.virusIncubation[eid] ?? 0)
          .u32(s.virusDeath[eid] ?? 0);
        const n = s.content.moodles.length;
        for (let i = 0; i < n; i++) h.u32(s.moodles[eid * n + i] ?? 0);
        const wounds = s.wounds.get(sid) ?? [];
        h.u32(wounds.length);
        for (const wd of wounds) {
          h.u32(wd.id).u32(wd.part).u32(wd.kind).u32(wd.ageMin).f32(wd.healed);
          h.u32(wd.bandaged ? 1 : 0)
            .u32(wd.bandageAgeMin)
            .u32(wd.dirt ? 1 : 0);
        }
      }
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
    getSurvival(playerId = 0) {
      const s = w.survival;
      const eid = w.players.get(playerId);
      if (!s || eid === undefined) return undefined;
      const stats = {} as Record<VitalStat, number>;
      for (const stat of VITAL_STATS) stats[stat] = s.vitals[stat][eid] ?? 0;
      const moodles: Record<string, number> = {};
      const n = s.content.moodles.length;
      for (let i = 0; i < n; i++) {
        const level = s.moodles[eid * n + i] ?? 0;
        if (level > 0) moodles[s.content.moodles[i]!.id] = level;
      }
      return {
        alive: !s.dead[eid],
        sleeping: s.asleep[eid] === 1,
        infected: s.virus[eid] === 1,
        stats,
        moodles,
        wounds: woundViews(w, eid),
      };
    },
    gameTime() {
      // Time of the last executed tick (stats of that minute are already applied).
      const minute = gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
      return { minute, day: dayOf(minute), minuteOfDay: minuteOfDay(minute) };
    },
    fastForwardBlocked() {
      const eid = w.players.get(0);
      return eid !== undefined && threatNearby(w, eid);
    },
    drainView: () => views.diff(w),
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
