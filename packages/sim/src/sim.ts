import {
  applyMarkerCommand,
  createPlayerMapWorld,
  DEFAULT_PLAYER_MAP,
  isMarkerCommand,
  MARKER_COMMANDS,
  primePlayerMaps,
  type PlayerMapConfig,
} from './map/player-map.js';
import { spawnChunkVehicles } from './vehicles/chunk-spawn.js';
import { createKey } from './vehicles/keys.js';
import { playerItems } from './items/inventory.js';
import { parseCommand } from '@deadzone/protocol/schema';
import { flushChunkEvents, primeChunkWatch } from './world/chunk-events.js';
import {
  CHUNK_SIZE,
  snapshotByteLength,
  type Command,
  type PlayerId,
  type SimEvent,
  type SimMap,
  type ActionView,
  type ContainerView,
  type InventoryView,
  type SimViewPatch,
  type VehiclePart,
  type SimZombieSpawn,
  type SimAnimalSpawn,
  type SimVehicleSpawn,
  type CharacterSpec,
  type WoundView,
  type WorldSource,
  worldSourceFromMap,
  MAP_MARKER_ICONS,
} from '@deadzone/protocol';
import {
  coarseTotal,
  floorTotal,
  createLodWorld,
  DEFAULT_SIM_LOD,
  lodApplies,
  populateLod,
  replayStairs,
  type SimLodConfig,
} from './lod/state.js';
import { hashLod } from './lod/hash.js';
import type { Stage4Config } from './ai/config.js';
import type { CombatConfig } from './combat/config.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './physics/constants.js';
import { hashAi } from './ai/hash.js';
import { PENALTY_SLOTS } from './survival/penalties.js';
import { hashCombat } from './combat/hash.js';
import { createAiWorld, ZOMBIE_STATE_NAMES, type ZombieStateName } from './ai/state.js';
import { spawnZombies } from './ai/zombies.js';
import { safeStartOf, unsafeSpot, type SafeStartOptions } from './lod/safe-start.js';
import { populateAnimals, spawnAnimals } from './animals/spawn.js';
import { spawnVehicles } from './vehicles/spawn.js';
import { partHp, setVehiclePartHp } from './vehicles/damage.js';
import { pullOutDriver, vehicleOpeningsOf, type VehicleOpening } from './vehicles/windows.js';

export type { VehicleOpening } from './vehicles/windows.js';
import { facingRadOf, vehicleSnapshotBytes, writeVehicleSnapshot } from './vehicles/snapshot.js';
import { sortedVehicles } from './vehicles/system.js';
import { vehicleTypes } from './vehicles/seats.js';
import { hashAnimals } from './animals/hash.js';
import { ANIMAL_STATE_NAMES, type AnimalStateName } from './animals/state.js';
import { threatLevel } from './ai/threat.js';
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
import { registerItemActions } from './items/actions.js';
import { applyNewCharacter } from './character/character.js';
import { createWorldContainers, scatterFloorLoot } from './items/loot.js';
import { scatterLoot } from './items/search.js';
import { loadWorld, readSaveHeader, saveWorld } from './save/save.js';
import { createItemStore, createPlayerItems } from './items/store.js';
import { actionView, containerView, inventoryView } from './items/views.js';
import { hashItems } from './items/hash.js';
import { addPhysicsBody, physicsMovementModifier } from './physics/system.js';
import { writePhysicsHash } from './physics/step.js';
import { registerMovementModifier } from './systems/movement.js';
import { TileGrid } from './world/grid.js';
import { initUtilities } from './items/utilities.js';

export interface SimOptions {
  seed: number;
  /** Tiles (a big generated world: `simMapFromWorldSource(world)`). */
  map: SimMap;
  /**
   * Where `map` comes from (generator seed + version, `chunkKind` for zombie density; docs
   * 9.24). Default: `worldSourceFromMap(map, { seed })` (generator version 0). Its bounds decide
   * whether the LOD runs (world bigger than the active window).
   */
  world?: WorldSource | undefined;
  /** Overrides of `worldSettings.simLod` (tests, tools). */
  lod?: Partial<SimLodConfig> | undefined;
  /**
   * Player 0 spawn in tiles (worker: `init.spawn`); default: first free tile centre of chunk
   * (0, 0, 0). Not checked against walls: the caller picks a free tile.
   */
  spawn?: { x: number; y: number; z?: number };
  /** Default `worldSettings.movement.walkSpeedMps`, else WALK_SPEED_TILES_PER_SECOND (1.5). */
  walkSpeedTilesPerSecond?: number;
  maxEntities?: number;
  commandWindowTicks?: number;
  /**
   * Content (a `ContentBundle` from packages/content, or any object with these fields). Without
   * it the sim runs movement only: no clock-driven survival, moodles or health.
   */
  content?: SimContent | undefined;
  /** Allows debug commands (`debugWound`, `debugStat`, `debugGiveItem`, `debugSpawnZombie`, `debugNoise`). Default false. */
  dev?: boolean | undefined;
  /**
   * Zombies at start (game modes, tests); needs content. `type` = zombie type id, omitted =
   * weighted by `spawnWeight`. Positions are used as given (pick free tiles).
   */
  spawnZombies?: readonly SimZombieSpawn[] | undefined;
  /**
   * New game only (ignored with `load`): no zombie within ~40 tiles of a player and none in a
   * player's line of sight for the first ~60 s (lod/safe-start.ts). Generated maps turn it on.
   */
  safeStart?: SafeStartOptions | undefined;
  /**
   * Animals at start at given points (needs content with `animalTypes`); `type` omitted =
   * weighted by `spawnWeight`. Positions are used as given (pick free tiles).
   */
  spawnAnimals?: readonly SimAnimalSpawn[] | undefined;
  /**
   * Populate the map with this many animals at init (`animals/spawn.ts`: outdoor tiles, habitat
   * by chunk, RNG stream `animals`). Default 0.
   */
  populateAnimals?: number | undefined;
  /**
   * Parked vehicles at start (needs content with `vehicleTypes`; `type` omitted = the first type
   * by id). Positions are used as given (pick a free spot).
   */
  spawnVehicles?: readonly SimVehicleSpawn[] | undefined;
  /** Stage 4 tuning without data fields yet (ai/config.ts); default DEFAULT_STAGE4_CONFIG. */
  aiConfig?: Stage4Config | undefined;
  /** Combat tuning without data fields yet (combat/config.ts); default DEFAULT_COMBAT_CONFIG. */
  combatConfig?: CombatConfig | undefined;
  /** Physics tuning (physics/constants.ts); default DEFAULT_PHYSICS_CONFIG. */
  physicsConfig?: PhysicsConfig | undefined;
  /**
   * Scatter single loot items on room floors and outdoors at init, plus `lootTable.scatter` items
   * (visible or hidden, items/search.ts) (worker: on). Default false.
   */
  floorLoot?: boolean | undefined;
  /** Restore a save from `Sim.save()` (same map, content and options; spawn options are ignored). */
  load?: Uint8Array | undefined;
  /** New game: player 0's character from the creator (ignored with `load`); invalid → throws. */
  character?: CharacterSpec | undefined;
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

/** Read-only animal state (tests, tools, debug overlays). */
export interface AnimalInfo {
  stableId: number;
  /** Animal type content id. */
  type: string;
  x: number;
  y: number;
  z: number;
  state: AnimalStateName;
  hp: number;
}

/** Read-only vehicle view (tests, tools, Symulacja). Heading in radians [0, 2π). */
export interface VehicleInfo {
  stableId: number;
  type: string;
  x: number;
  y: number;
  z: number;
  headingRad: number;
  /** Heading as BAM (u16, 65536 = 360°). */
  heading: number;
  /** Signed speed along the nose (m/s) and world velocity. */
  speed: number;
  vx: number;
  vy: number;
  steer: number;
  engineOn: boolean;
  handbrake: boolean;
  headlights: boolean;
  doorsOpen: number;
  /** StableId per seat, 0 = empty (seat 0 = driver). */
  occupants: number[];
  fuel: number;
  fuelMax: number;
  containers: number[];
  /** Gameplay (vehicles/keys.ts): locked doors, key in the ignition, hotwired. */
  locked: boolean;
  keyIn: boolean;
  hotwired: boolean;
  slip: number;
  /** Body zone hp 0..100: front, rear, left, right. */
  zones: number[];
  /** Engine hp 0..100 (0 = broken). */
  engine: number;
  /** Tyre hp 0..100: FL, FR, RL, RR. */
  tires: number[];
  /** Window hp 0..100: front, rear, left, right. */
  windows: number[];
  /** Per seat: ticks a zombie has been reaching in through a broken window (0 = none). */
  grab: number[];
  cx: number;
  cy: number;
  frozen: boolean;
}

/** LOD counters (debug HUD, tests); undefined when the LOD is off (small maps). */
export interface LodStats {
  /** Zombie entities (detailed). */
  activeZombies: number;
  /** Zombies as cell counters (coarse, plus pending spawns in active cells), all levels. */
  coarseZombies: number;
  /** Part of `coarseZombies` off the ground (levels ≠ 0, docs 9.39). */
  floorZombies: number;
  activeCells: number;
  /** Chunks with generated, unchanged loot (released when left). */
  liveChunks: number;
  /** Chunks that differ from the generated state (kept, saved as the delta). */
  dirtyChunks: number;
}

/** Read-only zombie state (tests, tools, debug overlays). */
export interface ZombieInfo {
  stableId: number;
  type: string;
  x: number;
  y: number;
  z: number;
  state: ZombieStateName;
  /** StableId of the chased player (0 = none). */
  targetId: number;
  hp: number;
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
  /** Speed-up must be ×1 now: a zombie chases the player or is within the threat radius. */
  fastForwardBlocked(): boolean;
  /** Speed-up the sim measures real time with (`setTimeScale`, 1 after a threat). */
  timeScale(): 1 | 2 | 4;
  /** HUD threat level 0–100 of a player (same as view `threat`). */
  threatLevel(playerId?: PlayerId): number;
  /** All zombies in StableId order. */
  getZombies(): ZombieInfo[];
  /** All animals (alive and corpses; gone birds excluded) in StableId order. */
  getAnimals(): AnimalInfo[];
  /** All vehicles in StableId order. */
  getVehicles(): VehicleInfo[];
  /**
   * Hp 0..100 of a vehicle part (`VEHICLE_PARTS`: engine, tireFL…tireRR, bodyFront…bodyRight,
   * windowFront…windowRight); undefined for an unknown vehicle / part.
   */
  getPartHp(vehicleId: number, part: VehiclePart): number | undefined;
  /**
   * Sets a part's hp (clamped 0..100; Symulacja repairs, scripted damage). An engine repaired from
   * 0 restarts when a driver sits in with fuel (`engineStart`); one set to 0 stops (`engineStop`
   * `broken`). Returns false for an unknown vehicle / part. Not a command: call it from the step
   * owner (hashed state).
   */
  setPartHp(vehicleId: number, part: VehiclePart, hp: number): boolean;
  /**
   * Broken windows of a vehicle (where zombies can reach in: centre, outward normal, half
   * length, seats behind it) for Symulacja's AI targeting; undefined for an unknown vehicle.
   */
  vehicleOpenings(vehicleId: number): VehicleOpening[] | undefined;
  /**
   * Forced exit (`pullOutDriver`): seat `seat` (default the driver) out through the side of
   * window `window` (0 front … 3 right; default the door), knocked down, `vehicleExit {reason:
   * 'pulled'}`. False for an empty seat / no free spot. Call from the step owner (hashed state).
   */
  pullOutOfVehicle(vehicleId: number, seat?: number, window?: number): boolean;
  /**
   * Puts a new key of `vehicleId` into the inventory of player `playerId` (tools/tests; call
   * from the step owner). Returns the item id, undefined without the car / player / key item.
   */
  giveVehicleKey(vehicleId: number, playerId?: PlayerId): number | undefined;
  /** Vehicle block of the render snapshot (protocol `VehicleField`, stride 21); empty without cars. */
  vehicleSnapshot(buf?: ArrayBuffer): ArrayBuffer;
  vehicleSnapshotByteLength(): number;
  /** UI view delta for player 0 since the last call (undefined when nothing changed). */
  drainView(): SimViewPatch | undefined;
  /** Full inventory view (all carried containers); undefined without content. */
  getInventory(playerId?: PlayerId): InventoryView | undefined;
  /** Full view of any container by id (tests, tools; no reach check). */
  getContainer(id: number): ContainerView | undefined;
  /** Current timed action of a player (null = none). */
  getAction(playerId?: PlayerId): ActionView | null;
  /** Escape hatch for tests and tools; systems' internals, not a stable API. */
  readonly world: SimWorld;
  /** Whole sim state as a versioned save (UTF-8 JSON bytes); `createSim({ load })` restores it. */
  save(): Uint8Array;
  /** LOD counters; undefined when the LOD is off. */
  lodStats(): LodStats | undefined;
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

export function createSim(input: SimOptions): Sim {
  // A save overrides the seed (the rest of the options must match the saved game).
  const opts = input.load ? { ...input, seed: readSaveHeader(input.load).seed } : input;
  const content = opts.content;
  registerItemActions();
  registerMovementModifier(physicsMovementModifier);
  const movement = (
    content?.worldSettings as
      { movement?: { walkSpeedMps: number; runSpeedMul: number } } | undefined
  )?.movement;
  const walkSpeed =
    opts.walkSpeedTilesPerSecond ?? movement?.walkSpeedMps ?? WALK_SPEED_TILES_PER_SECOND;
  // Physics speed classes (walk / run animation states) follow the data walk speed.
  const physicsConfig =
    opts.physicsConfig ??
    (movement &&
    (movement.walkSpeedMps !== WALK_SPEED_TILES_PER_SECOND || movement.runSpeedMul !== 2.5)
      ? {
          ...DEFAULT_PHYSICS_CONFIG,
          speed: {
            ...DEFAULT_PHYSICS_CONFIG.speed,
            walk: Math.fround(movement.walkSpeedMps / TICKS_PER_SECOND),
            run: Math.fround((movement.walkSpeedMps * movement.runSpeedMul) / TICKS_PER_SECOND),
          },
        }
      : undefined);
  const source = opts.world ?? worldSourceFromMap(opts.map, { seed: opts.seed });
  const w = createSimWorld({
    seed: opts.seed,
    map: opts.map,
    source,
    capacity: opts.maxEntities ?? DEFAULT_MAX_ENTITIES,
    commandWindowTicks: opts.commandWindowTicks ?? COMMAND_WINDOW_TICKS,
    dayLengthMinutes: opts.content?.worldSettings.dayLengthMinutes,
    clockStart: opts.clockStart,
    dev: opts.dev,
    physicsConfig,
    survival: content
      ? (clock) =>
          createSurvivalWorld(
            compileContent(content),
            opts.maxEntities ?? DEFAULT_MAX_ENTITIES,
            gameMinuteAt(clock, 0),
          )
      : undefined,
    items: (survival) => createItemStore(survival.content),
    ai: (survival) =>
      createAiWorld(
        survival.content,
        opts.map,
        opts.maxEntities ?? DEFAULT_MAX_ENTITIES,
        opts.aiConfig,
        opts.combatConfig,
      ),
  });
  const lodCfg: SimLodConfig = {
    ...DEFAULT_SIM_LOD,
    ...(w.survival?.content.simLod ?? {}),
    ...(opts.lod ?? {}),
  };
  if (w.ai && w.items && w.survival && lodApplies(lodCfg, source.bounds)) {
    w.lod = createLodWorld(lodCfg, source, w.survival.content, opts.floorLoot ?? false);
    // Loot appears per chunk when players come close (lod/chunks.ts); zombies start as counters.
    if (!opts.load) populateLod(w.lod, w.ai.spawnWeights);
  }
  {
    const ws = content?.worldSettings as
      | {
          mapMarkers?: Pick<PlayerMapConfig, 'icons' | 'colors' | 'maxMarkers' | 'maxTextLength'>;
          playerMap?: { discoverEverySec: number; trailSpacingM: number; trailMaxPoints: number };
        }
      | undefined;
    const mk = ws?.mapMarkers;
    const pmap = ws?.playerMap;
    w.playerMap = createPlayerMapWorld(w, {
      ...DEFAULT_PLAYER_MAP,
      ...(mk
        ? {
            // Only icons the server accepts in a save (`MAP_MARKER_ICONS`, protocol).
            icons: mk.icons.filter((i) => (MAP_MARKER_ICONS as readonly string[]).includes(i)),
            colors: mk.colors,
            maxMarkers: mk.maxMarkers,
            maxTextLength: mk.maxTextLength,
          }
        : {}),
      ...(pmap
        ? {
            discoverEveryTicks: Math.max(1, Math.round(pmap.discoverEverySec * TICKS_PER_SECOND)),
            trailSpacingM: pmap.trailSpacingM,
            trailMaxPoints: pmap.trailMaxPoints,
          }
        : {}),
    });
  }
  // Before a load restores them (older saves keep the rolled days).
  initUtilities(w);
  if (w.items && !opts.load && !w.lod) {
    createWorldContainers(w.items, opts.map, w.seed);
    if (opts.floorLoot) {
      scatterFloorLoot(w.items, opts.map, w.seed, w.clock.startMinute);
      scatterLoot(w.items, opts.map, w.seed, w.clock.startMinute);
    }
  }
  const minutes: MinuteTicks = { first: 0, count: 0 };
  const ctx: SystemContext = {
    grid: new TileGrid(opts.map, w.openings),
    minutes,
    ambientC: opts.ambientTemperatureC ?? DEFAULT_AMBIENT_C,
  };
  if (w.lod && source.bounds.z1 > source.bounds.z0) ctx.grid.multiLevel = true;
  w.physics.stairs = ctx.grid.stairs;
  w.physics.multiLevel = ctx.grid.multiLevel;
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
    c.MoveStats.speedPerTick[eid] = Math.fround(walkSpeed / TICKS_PER_SECOND);
    c.Player.id[eid] = playerId;
    w.players.set(playerId, eid);
    if (w.survival) initVitals(w.survival, eid);
    if (w.items) createPlayerItems(w.items, c.StableId.value[eid] ?? 0);
    addPhysicsBody(w, eid);
    return eid;
  };

  if (opts.load) {
    loadWorld(w, opts.load);
    // Lazily registered stairs come back in the saved order (stair ids are state).
    if (w.lod) replayStairs(w.lod, ctx.grid);
  } else {
    const spawn = opts.spawn ?? findSpawn(ctx.grid);
    spawnPlayer(0, spawn.x, spawn.y, opts.spawn?.z ?? 0);
    if (opts.safeStart) w.safeStart = safeStartOf(opts.safeStart, w.tick, TICKS_PER_SECOND);
    const safe = w.safeStart;
    if (opts.spawnZombies)
      spawnZombies(
        w,
        safe
          ? opts.spawnZombies.filter((z) => !unsafeSpot(w, ctx.grid, safe, z.x, z.y, z.z ?? 0))
          : opts.spawnZombies,
      );
    if (opts.spawnAnimals) spawnAnimals(w, opts.spawnAnimals);
    if (opts.spawnVehicles) spawnVehicles(w, opts.spawnVehicles);
    // Parked cars from chunk data (whole map; with LOD they come with each chunk's loot).
    if (!w.lod) {
      const list = [...(opts.map.listChunks?.() ?? [])].sort(
        (a, b) => a.z - b.z || a.cy - b.cy || a.cx - b.cx,
      );
      for (const a of list) spawnChunkVehicles(w, a.cx, a.cy, a.z, -1);
    }
    if (opts.populateAnimals) populateAnimals(w, ctx.grid, opts.populateAnimals);
    if (opts.character) {
      const r = applyNewCharacter(w, w.players.get(0)!, opts.character);
      if (r) throw new Error(`character: ${r.detail ?? r.reason}`);
    }
  }

  const hash = (): number => {
    const h = new HashWriter();
    h.u32(w.tick).u32(w.seed).u32(w.nextStableId);
    for (const name of RNG_STREAMS) {
      if (name === 'animals') continue; // animal section (hashAnimals)
      for (const word of w.rng[name].state()) h.u32(word);
    }
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
      h.f32(c.MoveStats.speedPerTick[eid] ?? 0).f32(c.MoveStats.accel[eid] ?? 0);
    }
    const s = w.survival;
    if (s) {
      // Survival section (absent without content, so movement-only golden hashes stay valid).
      h.u32(w.clock.ticksPerDay).u32(w.clock.startMinute).u32(s.lastMinute).u32(s.nextWoundId);
      if (s.timeScale !== 1) h.u32(0x7153_0001).u32(s.timeScale);
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
        h.u32(s.sleepSurface[eid] ?? 0).f32(s.sleepRecovered[eid] ?? 0);
        h.u32(s.sleepTicks[eid] ?? 0).u32(s.sleepSaved[eid] ?? 0);
        // Real sleep time: only when it differs from ×1 (keeps older goldens).
        const realQ = s.sleepRealQ[eid] ?? 0;
        if (realQ !== (s.sleepTicks[eid] ?? 0) * 4) h.u32(0x5ee9_0001).u32(realQ);
        for (let i = 0; i < PENALTY_SLOTS; i++) h.f32(s.penalties[eid * PENALTY_SLOTS + i] ?? 0);
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
        h.f32(s.carryLoad[eid] ?? 0).f32(s.bagSpeed[eid] ?? 1);
      }
    }
    if (w.items) hashItems(w.items, h);
    hashAi(w, h);
    hashAnimals(w, h);
    hashCombat(w, h);
    writePhysicsHash(w.physics, h);
    // LOD section only when the LOD runs (keeps the goldens of small maps).
    hashLod(w, h);
    // Doors / windows: only when something differs from the map (keeps older goldens).
    const o = w.openings;
    if (o.states.size > 0 || o.bashAt.size > 0) {
      h.u32(o.states.size).u32(o.bashAt.size);
      for (const k of [...o.states.keys()].sort((a, b) => a - b)) {
        const e = o.states.get(k)!;
        h.u32(k % 0x100000000)
          .u32(Math.floor(k / 0x100000000))
          .u32(e.kind)
          .u32(e.state)
          .f32(e.hp);
        // Planks / cleared glass only when set (older goldens).
        if (e.planks || e.cleared) h.u32(0xba44_0001).u32(e.planks).f32(e.bhp).u32(e.cleared);
      }
      for (const k of [...o.bashAt.keys()].sort((a, b) => a - b)) h.u32(k).u32(o.bashAt.get(k)!);
    }
    return h.digest();
  };

  primeChunkWatch(w);
  // A loaded save already has its map; priming again would add a trail point the original lacks.
  if (!opts.load) primePlayerMaps(w, ctx.grid);
  return {
    get tick() {
      return w.tick;
    },
    seed: w.seed,
    world: w,
    enqueue: (cmd) => {
      // Map markers: system commands applied at once (also while paused), no seq ordering.
      if (MARKER_COMMANDS.has((cmd as { type?: Command['type'] }).type!)) {
        const parsed = parseCommand(cmd);
        if (!parsed.ok) return { ok: false, reason: 'invalid', error: parsed.error };
        const c = parsed.command;
        const reason = isMarkerCommand(c) ? applyMarkerCommand(w, c) : 'invalid';
        if (reason) {
          w.events.push({
            type: 'commandRejected',
            tick: w.tick,
            playerId: c.playerId,
            seq: c.seq,
            command: c.type,
            reason,
          });
          return { ok: false, reason };
        }
        return { ok: true, tick: w.tick };
      }
      return w.queue.enqueue(cmd, w.tick);
    },
    step() {
      for (const sys of PIPELINE) sys.run(w, ctx);
      flushChunkEvents(w);
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
    timeScale: () => (w.survival?.timeScale ?? 1) as 1 | 2 | 4,
    fastForwardBlocked() {
      const eid = w.players.get(0);
      return eid !== undefined && threatNearby(w, eid);
    },
    threatLevel(playerId = 0) {
      const eid = w.players.get(playerId);
      return eid === undefined ? 0 : threatLevel(w, eid);
    },
    getZombies() {
      const ai = w.ai;
      if (!ai) return [];
      return sortedQuery(w, 'zombies', [c.Zombie]).map((eid) => ({
        stableId: c.StableId.value[eid] ?? 0,
        type: ai.types[c.Zombie.type[eid] ?? 0]?.def.id ?? '',
        x: c.Position.x[eid] ?? 0,
        y: c.Position.y[eid] ?? 0,
        z: c.Position.z[eid] ?? 0,
        state: ZOMBIE_STATE_NAMES[c.Zombie.state[eid] ?? 0] ?? 'idle',
        targetId: c.Zombie.targetId[eid] ?? 0,
        hp: c.Zombie.hp[eid] ?? 0,
      }));
    },
    getAnimals() {
      const ai = w.ai;
      if (!ai) return [];
      const A = c.Animal;
      return sortedQuery(w, 'animals', [A]).flatMap((eid) => {
        const state = ANIMAL_STATE_NAMES[A.state[eid] ?? 0] ?? 'graze';
        if (state === 'gone') return [];
        return [
          {
            stableId: c.StableId.value[eid] ?? 0,
            type: ai.animalTypes[A.type[eid] ?? 0]?.def.id ?? '',
            x: c.Position.x[eid] ?? 0,
            y: c.Position.y[eid] ?? 0,
            z: c.Position.z[eid] ?? 0,
            state,
            hp: A.hp[eid] ?? 0,
          },
        ];
      });
    },
    getVehicles: () =>
      sortedVehicles(w).map((v) => ({
        stableId: v.id,
        type: vehicleTypes(w)[v.type]?.id ?? '',
        x: v.x,
        y: v.y,
        z: v.z,
        headingRad: facingRadOf(v),
        heading: v.heading,
        speed: v.speed,
        vx: v.vx,
        vy: v.vy,
        steer: v.steer,
        engineOn: v.engineOn,
        handbrake: v.handbrake,
        headlights: v.headlights,
        doorsOpen: v.doorsOpen,
        occupants: [...v.occupants],
        fuel: v.fuel,
        fuelMax: v.fuelMax,
        containers: [...v.containers],
        locked: v.locked,
        keyIn: v.keyIn,
        hotwired: v.hotwired,
        slip: v.slip,
        zones: [...v.zones],
        engine: v.engine,
        tires: [...v.tires],
        windows: [...v.windows],
        grab: [...v.grab],
        cx: v.cx,
        cy: v.cy,
        frozen: v.frozenAt >= 0,
      })),
    getPartHp(vehicleId, part) {
      const v = w.physics.vehicles.get(vehicleId);
      return v ? partHp(v, part) : undefined;
    },
    setPartHp(vehicleId, part, hp) {
      const v = w.physics.vehicles.get(vehicleId);
      return v ? setVehiclePartHp(w, v, part, hp) : false;
    },
    vehicleOpenings(vehicleId) {
      const v = w.physics.vehicles.get(vehicleId);
      return v ? vehicleOpeningsOf(w, v) : undefined;
    },
    pullOutOfVehicle: (vehicleId, seat = 0, window) =>
      pullOutDriver(w, ctx.grid, vehicleId, seat, window),
    giveVehicleKey(vehicleId, playerId = 0) {
      const v = w.physics.vehicles.get(vehicleId);
      const eid = w.players.get(playerId);
      const p = eid === undefined ? undefined : playerItems(w, eid);
      return v && p ? createKey(w, v, p.inventory)?.id : undefined;
    },
    vehicleSnapshot: (buf) => writeVehicleSnapshot(w, buf),
    vehicleSnapshotByteLength: () => vehicleSnapshotBytes(w),
    drainView: () => views.diff(w, ctx.grid),
    save: () => saveWorld(w),
    lodStats() {
      const lod = w.lod;
      if (!lod) return undefined;
      let dirty = 0;
      for (let i = 0; i < lod.chunkLoot.length; i++) if (lod.chunkLoot[i] === 2) dirty++;
      return {
        activeZombies: w.ai?.zombieCount ?? 0,
        coarseZombies: coarseTotal(lod),
        floorZombies: floorTotal(lod),
        activeCells: lod.activeCells.length,
        liveChunks: lod.liveChunks.length,
        dirtyChunks: dirty,
      };
    },
    getInventory(playerId = 0) {
      const eid = w.players.get(playerId);
      return eid === undefined ? undefined : inventoryView(w, eid);
    },
    getContainer: (id) => containerView(w, id),
    getAction(playerId = 0) {
      const eid = w.players.get(playerId);
      return eid === undefined ? null : actionView(w, eid);
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
