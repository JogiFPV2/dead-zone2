/**
 * Stage 4 tuning that has no fields in `worldSettings` yet (docs/sim-architecture.md 9.7). All
 * defaults live here, in one place, until Modules adds the data; the proposed field names are in
 * the comments (`worldSettings.vision.*`, `worldSettings.noise.*`, `worldSettings.ai.*`).
 * Values from the data always win: zombie senses and speeds come from `zombieTypes`, the threat
 * radius and noise waking from `worldSettings.survival.sleep`.
 */
export interface VisionConfig {
  /** `vision.playerSightTiles`: player sight range in daylight (stat `sight-range-tiles`). */
  playerSightTiles: number;
  /** `vision.nightFactor`: sight range multiplier at full night (same model for players and zombies). */
  nightFactor: number;
  /** `vision.dawnStartMin` … `vision.duskEndMin`: minutes of day of the linear day ↔ night blend. */
  dawnStartMin: number;
  dawnEndMin: number;
  duskStartMin: number;
  duskEndMin: number;
  /** `worldSettings.vision.lightBonus`: in light the factor rises by lightBonus × intensity (max 1). */
  lightBonus: number;
  /** `worldSettings.vision.enabled`: false = full visibility everywhere. */
  enabled: boolean;
  /** `vision.sneakVisibilityMul`: a sneaking target is seen from this fraction of the range. */
  sneakVisibilityMul: number;
  /** `vision.fovHalfAngleDeg`: zombie sight cone; closer than `nearSenseTiles` they notice all around. */
  fovHalfAngleDeg: number;
  nearSenseTiles: number;
  /** `vision.penalties`: pain and fever narrow the player's sight (hook, multiplied, floor `minMul`). */
  penalties: {
    painFrom: number;
    painMulAt100: number;
    feverFromC: number;
    feverFullC: number;
    feverMul: number;
    minMul: number;
  };
}

export interface NoiseConfig {
  /** `noise.footsteps`: radius (tiles) and volume per gait, emitted every `footstepEveryTicks`. */
  footsteps: Record<'sneak' | 'walk' | 'run', { radiusTiles: number; volume: number }>;
  footstepEveryTicks: number;
  /** `noise.actions`: noise when a timed action starts (search, eat …). */
  actions: Record<
    'search' | 'eat' | 'drink' | 'bandage' | 'unpack',
    { radiusTiles: number; volume: number }
  >;
  /** `noise.wallMul`: effective radius × this for every wall / window between source and listener. */
  wallMul: number;
  /** Walls counted at most (beyond that the noise is gone anyway). */
  maxWalls: number;
  /** `noise.referenceHearingTiles`: hearing range at which a noise travels exactly its radius. */
  referenceHearingTiles: number;
}

export interface AiConfig {
  /** Perception and decisions every N ticks (StableId % N spreads the load). */
  thinkEveryTicks: number;
  /** Beyond this distance from every player: simplified mode (think every `farThinkEveryTicks`, no LOS). */
  farTiles: number;
  farThinkEveryTicks: number;
  /** `ai.memorySec`: a zombie that lost sight keeps chasing the last known position this long. */
  memorySec: number;
  /** `ai.searchSec`: then it searches around that spot before wandering again. */
  searchSec: number;
  /** `ai.investigateLingerSec`: time spent at a noise (lures use their own `lingerSec`). */
  investigateLingerSec: { min: number; max: number };
  /** `ai.wander*`: wander goal radius and pause between goals (real seconds). */
  wanderRadiusTiles: number;
  wanderPauseSec: { min: number; max: number };
  /** Speed spread per zombie at spawn (± fraction of the type's speeds). */
  speedSpread: number;
  /** Stops this close to the chased player (centre distance; attacks come with combat). */
  reachTiles: number;
  /** Neighbour separation radius (soft push, zombies do not collide with each other). */
  separationTiles: number;
  zombieRadius: number;
  /** A* budget: node expansions per tick for all requests and per request. */
  navBudgetPerTick: number;
  navMaxNodesPerRequest: number;
  /** Flow field window (tiles, square around the player) and minimum rebuild interval. */
  flowWindowTiles: number;
  flowEveryTicks: number;
  /** Ticks without progress before a re-path. */
  stuckTicks: number;
}

export interface GaitConfig {
  /** `movement.sneakSpeedMul` / `movement.runSpeedMul`: × walk speed. */
  sneakSpeedMul: number;
  runSpeedMul: number;
}

export interface Stage4Config {
  vision: VisionConfig;
  noise: NoiseConfig;
  ai: AiConfig;
  gait: GaitConfig;
}

export const DEFAULT_STAGE4_CONFIG: Stage4Config = {
  vision: {
    playerSightTiles: 30,
    nightFactor: 0.4,
    lightBonus: 0.5,
    enabled: true,
    dawnStartMin: 5 * 60,
    dawnEndMin: 7 * 60,
    duskStartMin: 19 * 60,
    duskEndMin: 21 * 60,
    sneakVisibilityMul: 0.6,
    fovHalfAngleDeg: 70,
    nearSenseTiles: 2.5,
    penalties: {
      painFrom: 40,
      painMulAt100: 0.7,
      feverFromC: 37.5,
      feverFullC: 40,
      feverMul: 0.7,
      minMul: 0.4,
    },
  },
  noise: {
    footsteps: {
      sneak: { radiusTiles: 1.5, volume: 0.1 },
      walk: { radiusTiles: 5, volume: 0.25 },
      run: { radiusTiles: 12, volume: 0.5 },
    },
    footstepEveryTicks: 10,
    actions: {
      search: { radiusTiles: 4, volume: 0.25 },
      eat: { radiusTiles: 1.5, volume: 0.1 },
      drink: { radiusTiles: 1.5, volume: 0.1 },
      bandage: { radiusTiles: 2, volume: 0.15 },
      unpack: { radiusTiles: 2, volume: 0.15 },
    },
    wallMul: 0.5,
    maxWalls: 4,
    referenceHearingTiles: 30,
  },
  ai: {
    thinkEveryTicks: 4,
    farTiles: 64,
    farThinkEveryTicks: 20,
    memorySec: 6,
    searchSec: 8,
    investigateLingerSec: { min: 4, max: 10 },
    wanderRadiusTiles: 6,
    wanderPauseSec: { min: 2, max: 8 },
    speedSpread: 0.1,
    reachTiles: 0.75,
    separationTiles: 0.7,
    zombieRadius: 0.3,
    navBudgetPerTick: 2000,
    navMaxNodesPerRequest: 1500,
    flowWindowTiles: 64,
    flowEveryTicks: 5,
    stuckTicks: 20,
  },
  gait: { sneakSpeedMul: 0.5, runSpeedMul: 1.6 },
};
