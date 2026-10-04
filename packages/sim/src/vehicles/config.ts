/**
 * Vehicle tuning (one place, like `physics/constants.ts`). Units: metres (1 tile = 1 m), m/s,
 * m/s², seconds, kg, J. Speed thresholds are in m/s on purpose (not relative to the player's
 * walking speed, which Symulacja is retuning).
 */
export interface VehicleConfig {
  /** Full steering lock (front wheel angle, rad) at standstill; less at speed (`steerFalloffMs`). */
  maxSteerRad: number;
  steerFalloffMs: number;
  /** How fast the wheels follow the steering input (lock-to-lock fraction per second). */
  steerRatePerSec: number;
  /** Tyre grip (lateral and longitudinal acceleration limit) = μ·g, falls with speed. */
  gripAccel: number;
  /** Grip × 1 / (1 + speed / gripFalloffMs). */
  gripFalloffMs: number;
  /** Fraction of the sideways velocity the rear tyres remove per second (at full grip). */
  lateralGripPerSec: number;
  /** Handbrake: rear grip × this (the rear slides), extra yaw × `handbrakeYawMul`, decel. */
  handbrakeGrip: number;
  handbrakeYawMul: number;
  handbrakeDecel: number;
  /** Yaw rate follows the steering target by this fraction per tick. */
  yawResponse: number;
  /** Full-brake deceleration; when (nearly) stopped the brake pedal reverses. */
  brakeDecel: number;
  reverseAccel: number;
  reverseMaxSpeed: number;
  /** Below this speed the brake pedal counts as reverse. */
  stopSpeed: number;
  /** Rolling resistance (m/s²) and air drag coefficient (m/s² per (m/s)²). */
  rolling: number;
  drag: number;
  /** Engine force is limited at low speed: power / max(v, this). */
  minPowerSpeed: number;
  /** Share of the engine power at the wheels (gears, losses; arcade launch feel). */
  drivetrainEff: number;
  /** Idle fuel use × consumption (engine on, no throttle). */
  idleConsumption: number;
  /** Bounce of the normal velocity in a hit (0 = dead stop, 1 = elastic). */
  restitution: number;
  /** A standing fence hit faster than this (normal speed) is knocked over. */
  fenceBreakSpeed: number;
  /** Speed lost when breaking through a fence (fraction of the normal speed). */
  fenceSlow: number;
  /** Impacts below this energy send no `vehicleImpact`. */
  minImpactJ: number;
  /** Mass of a person / zombie / animal body hit by a car when it has no physics mass. */
  bodyMassKg: number;
  /** Enter: max distance from the door point; max car speed to enter / exit. */
  enterRange: number;
  enterMaxSpeed: number;
  exitMaxSpeed: number;
  /** Door point: this far outside the car's side. */
  doorGap: number;
  /** A door stays open this long after getting in / out (ticks). */
  doorOpenTicks: number;
  /** Engine noise: every N ticks, radius idle → full throttle (tiles), volume. */
  noiseEveryTicks: number;
  noiseIdleTiles: number;
  noiseFullTiles: number;
  noiseVolume: number;
  /** Collision passes per tick (walls, bodies, vehicles). */
  passes: number;
  /**
   * Ramming a standing body (closing speed at the contact, m/s; walking is 1.5 m/s, running
   * 3.75 m/s): below `ramStaggerSpeed` the body is only pushed, then stagger, from
   * `ramKnockdownSpeed` a knock-down, from `ramKillSpeed` a zombie dies (a player is knocked
   * down; wounds from cars come with Symulacja's damage model).
   */
  ramStaggerSpeed: number;
  ramKnockdownSpeed: number;
  ramKillSpeed: number;
  /** A body hit by a car is not rammed again for this many ticks (it is being pushed along). */
  ramCooldownTicks: number;
  /**
   * A body lying under the car (knocked down, getting up, dead) is not pushed out: the car rolls
   * over it, loses `underWheelDecel` m/s² per body and the nearest wheel bumps up. A knocked-down
   * zombie run over at `crushSpeed` or more dies.
   */
  underWheelDecel: number;
  crushSpeed: number;
  /** Shoving a body that stays in front of the car costs this much (m/s² per body). */
  plowDecel: number;
  /**
   * Damage (PR B, `damage.ts`): an impact takes (energy − `damageMinJ`) / 1 kJ × `zoneDmgPerKJ`
   * hp from the zone hit (a 6 m/s wall hit ≈ 20 hp, a zombie at 11 m/s ≈ 2.5 hp); its window
   * `windowDmgMul` ×, the nearest tyre `tireDmgMul` ×; a front hit `engineDmgShare` × to the
   * engine (full damage once the front zone is below `engineExposedBelow`).
   */
  damageMinJ: number;
  zoneDmgPerKJ: number;
  /** Soft targets (zombies, players, animals) do only this fraction of that damage. */
  softDmgMul: number;
  windowDmgMul: number;
  tireDmgMul: number;
  engineDmgShare: number;
  engineExposedBelow: number;
  /** Rolling over a body: tyre hp per tick at 10 m/s; the zone over it gets this fraction. */
  rollTireDmg: number;
  rollBodyDmg: number;
  /** Engine below this hp: power × hp / threshold (at least `engineMinPower`). */
  engineThreshold: number;
  engineMinPower: number;
  /** A tyre below this hp is going flat: steering pull (`tirePull` at a flat front tyre), grip × (1 − `flatGripLoss` × mean flatness). */
  tireFlatBelow: number;
  tirePull: number;
  flatGripLoss: number;
}

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  maxSteerRad: 0.6,
  steerFalloffMs: 25,
  steerRatePerSec: 4,
  gripAccel: 8.8,
  gripFalloffMs: 60,
  lateralGripPerSec: 12,
  handbrakeGrip: 0.12,
  handbrakeYawMul: 1.6,
  handbrakeDecel: 3,
  yawResponse: 0.35,
  brakeDecel: 9,
  reverseAccel: 3,
  reverseMaxSpeed: 6,
  stopSpeed: 0.3,
  rolling: 0.15,
  drag: 0.0004,
  minPowerSpeed: 8,
  drivetrainEff: 0.55,
  idleConsumption: 0.1,
  restitution: 0.2,
  fenceBreakSpeed: 2.5,
  fenceSlow: 0.25,
  minImpactJ: 150,
  bodyMassKg: 75,
  enterRange: 1.5,
  enterMaxSpeed: 1,
  exitMaxSpeed: 1.5,
  doorGap: 0.4,
  doorOpenTicks: 12,
  noiseEveryTicks: 10,
  noiseIdleTiles: 10,
  noiseFullTiles: 35,
  noiseVolume: 0.8,
  passes: 3,
  ramStaggerSpeed: 1.5,
  ramKnockdownSpeed: 4,
  ramKillSpeed: 9,
  ramCooldownTicks: 10,
  underWheelDecel: 6,
  crushSpeed: 7,
  plowDecel: 1.5,
  damageMinJ: 300,
  zoneDmgPerKJ: 1,
  softDmgMul: 0.6,
  windowDmgMul: 1.5,
  tireDmgMul: 0.3,
  engineDmgShare: 0.5,
  engineExposedBelow: 30,
  rollTireDmg: 0.4,
  rollBodyDmg: 0.25,
  engineThreshold: 50,
  engineMinPower: 0.3,
  tireFlatBelow: 40,
  tirePull: 0.015,
  flatGripLoss: 0.35,
};
