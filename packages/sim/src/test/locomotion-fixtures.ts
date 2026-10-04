import { dsincos } from '../vehicles/math.js';
import type { Gait } from '@deadzone/protocol';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { createSim, type Sim } from '../sim.js';
import { buildMap, type MapSpec } from './fixtures.js';
import { moveGait } from './helpers.js';

/** One tick of a player trace: position (tiles), velocity (m/s), facing (BAM). */
export interface LocoSample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

/** Open 128 × 64 field (or `map`), player at (x, y), no content (plain movement). */
export function locoSim(x: number, y: number, map: MapSpec = {}, seed = 1): Sim {
  return createSim({ seed, map: buildMap({ width: 128, height: 64, ...map }), spawn: { x, y } });
}

export function sample(sim: Sim): LocoSample {
  const eid = sim.world.players.get(0)!;
  const p = sim.getPlayer()!;
  const vx = (sim.world.c.Velocity.x[eid] ?? 0) * TICKS_PER_SECOND;
  const vy = (sim.world.c.Velocity.y[eid] ?? 0) * TICKS_PER_SECOND;
  return { t: sim.tick, x: p.x, y: p.y, vx, vy, speed: Math.sqrt(vx * vx + vy * vy) };
}

/** Steps `n` ticks and returns the samples after each one. */
export function trace(sim: Sim, n: number, out: LocoSample[] = []): LocoSample[] {
  for (let i = 0; i < n; i++) {
    sim.step();
    out.push(sample(sim));
  }
  return out;
}

export interface ProfileResult {
  gait: Gait;
  samples: LocoSample[];
  /** Ticks from the move command until the speed is at the target (within 0.1 %). */
  ticksToMax: number;
  maxSpeed: number;
  /** Distance from releasing the input to standing still (tiles), and the ticks it took. */
  brakeDist: number;
  brakeTicks: number;
  /** Tick (index in samples) the input was released. */
  release: number;
}

/** Accelerates along +x for 1.5 s with `gait`, then releases and brakes to a stop. */
export function profileRun(gait: Gait, y = 10.5): ProfileResult {
  const sim = locoSim(4.5, y);
  moveGait(sim, 1, 0, gait);
  const s = trace(sim, 30);
  const maxSpeed = Math.max(...s.map((p) => p.speed));
  const ticksToMax = s.findIndex((p) => p.speed >= maxSpeed * 0.999) + 1;
  const x0 = s.at(-1)!.x;
  moveGait(sim, 0, 0, gait);
  const release = s.length;
  trace(sim, 40, s);
  const stop = s.findIndex((p, i) => i >= release && p.speed === 0);
  return {
    gait,
    samples: s,
    ticksToMax,
    maxSpeed,
    brakeDist: s.at(-1)!.x - x0,
    brakeTicks: stop - release + 1,
    release,
  };
}

export interface TurnResult {
  gait: Gait;
  deg: number;
  samples: LocoSample[];
  /** Index in samples where the new direction was given. */
  turnAt: number;
  /** Ticks until the velocity points within 2° of the new direction. */
  ticksToAlign: number;
  /** Lowest speed after the turn command (m/s). */
  minSpeed: number;
  /** Max sideways drift past the turn point along the old direction (tiles). */
  overshoot: number;
}

/** Moves +x at `gait` for 1.5 s, then turns the input by `deg` (counter-clockwise on screen: −y). */
export function turnRun(gait: Gait, deg: number, start = { x: 20.5, y: 32.5 }): TurnResult {
  const sim = locoSim(start.x, start.y);
  moveGait(sim, 1, 0, gait);
  const s = trace(sim, 30);
  const turnAt = s.length;
  const a = (deg * Math.PI) / 180;
  const ux = Math.round(dsincos(a)[1] * 1e6) / 1e6;
  const uy = -Math.round(dsincos(a)[0] * 1e6) / 1e6;
  moveGait(sim, ux, uy, gait);
  const x0 = s.at(-1)!.x;
  trace(sim, 40, s);
  const after = s.slice(turnAt);
  const cos2 = dsincos((2 * Math.PI) / 180)[1];
  const align = after.findIndex((p) => p.speed > 0 && (p.vx * ux + p.vy * uy) / p.speed >= cos2);
  return {
    gait,
    deg,
    samples: s,
    turnAt,
    ticksToAlign: align + 1,
    minSpeed: Math.min(...after.map((p) => p.speed)),
    overshoot: Math.max(0, ...after.map((p) => p.x - x0)),
  };
}
