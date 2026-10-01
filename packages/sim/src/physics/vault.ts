import type { CommandRejectReason } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { openingKey, OpeningKind, OS } from '../openings/state.js';
import { skillLevel } from '../progress/skills.js';
import { woundKindIndex } from '../survival/state.js';
import { inflictWound } from '../survival/wounds.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ, hasFloor } from '../world/levels.js';
import { canAct, enduranceLevel, loadLevel } from './modifiers.js';
import { setState } from './reactions.js';
import type { PhysicsBody, PhysicsEvent } from './types.js';

/**
 * Vaulting (PZ): a player hops a standing low fence (about a second) or climbs through an open /
 * broken window (a bit longer). Zombies never vault: they push a standing fence over (`crowd.ts`)
 * and climb a knocked-over one slowly (`EF.slow`, like windows). During `vault` the body follows a
 * straight line from its position to a landing point beyond the edge (no collisions: the edge
 * itself blocks walking); hits are recorded without a reaction. On landing: the trip roll (chance
 * fixed at the start: base + running + load + fatigue, less with Nimble / Fitness) and, through a
 * broken window, the glass roll. Exactly 3 `rng.physics` draws per landing.
 */

const SKILL_NIMBLE = 'base:nimble';
const SKILL_FITNESS = 'base:fitness';
/** Glass cuts: forearm l / r, hand l / r, thigh l / r (BODY_PARTS indices). */
const GLASS_PARTS = [7, 8, 9, 10, 11, 12] as const;

interface VaultEdge {
  /** OpeningKind of the edge (fence or window). */
  kind: number;
  glass: boolean;
  /** Edge line coordinate (y for n edges, x for w edges) and the crossing direction. */
  line: number;
  dx: number;
  dy: number;
  /** Tile beyond the edge. */
  tx: number;
  ty: number;
}

const body = (w: SimWorld, eid: number): PhysicsBody | undefined =>
  w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);

/** The vaultable edge of the body's tile nearest to (x, y) within reach (fixed order on ties). */
function findEdge(
  w: SimWorld,
  grid: TileGrid,
  x: number,
  y: number,
  z: number,
): VaultEdge | undefined {
  const reach = w.physics.cfg.vault.reachTiles;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  // [distance, side (0 = n, 1 = w), edge tile, direction]
  const cands: [number, number, number, number, number, number][] = [
    [y - ty, 0, tx, ty, 0, -1],
    [tx + 1 - x, 1, tx + 1, ty, 1, 0],
    [ty + 1 - y, 0, tx, ty + 1, 0, 1],
    [x - tx, 1, tx, ty, -1, 0],
  ];
  let best: VaultEdge | undefined;
  let bestD = Infinity;
  for (const [d, side, ex, ey, dx, dy] of cands) {
    if (d > reach || d >= bestD) continue;
    const id = side === 0 ? grid.edgeN(ex, ey, z) : grid.edgeW(ex, ey, z);
    const kind = grid.kindOf(id);
    if (kind !== OpeningKind.fence && kind !== OpeningKind.window) continue;
    const state = w.openings.states.get(openingKey(side, ex, ey, z))?.state ?? OS.closed;
    const ok =
      kind === OpeningKind.fence ? state === OS.closed : state === OS.open || state === OS.broken;
    if (!ok) continue;
    bestD = d;
    best = {
      kind,
      glass: kind === OpeningKind.window && state === OS.broken,
      line: side === 0 ? ey : ex,
      dx,
      dy,
      tx: tx + dx,
      ty: ty + dy,
    };
  }
  return best;
}

/** A circle of radius r at (x, y) in tile (tx, ty) has floor and touches no blocking edge. */
function fits(grid: TileGrid, z: number, tx: number, ty: number, x: number, y: number, r: number) {
  if (!hasFloor(grid, tx, ty, z)) return false;
  return !(
    (y - ty < r && grid.hasWallN(tx, ty, z)) ||
    (ty + 1 - y < r && grid.hasWallN(tx, ty + 1, z)) ||
    (x - tx < r && grid.hasWallW(tx, ty, z)) ||
    (tx + 1 - x < r && grid.hasWallW(tx + 1, ty, z))
  );
}

/** Trip chance of a vault started now (PZ: running, heavy load and fatigue trip; Nimble helps). */
export function tripChance(w: SimWorld, eid: number, b: PhysicsBody, kind: number): number {
  const c = w.physics.cfg.vault;
  let p = kind === OpeningKind.fence ? c.tripFence : c.tripWindow;
  if (b.state === 'run') p += c.tripRun;
  p += c.tripLoad[loadLevel(b.carriedKg, b.capacityKg)] ?? 0;
  p += c.tripEndurance[enduranceLevel(b.endurance)] ?? 0;
  const skill =
    1 -
    skillLevel(w, eid, SKILL_NIMBLE) * c.tripPerNimble -
    skillLevel(w, eid, SKILL_FITNESS) * c.tripPerFitness;
  p *= Math.max(c.tripSkillFloor, skill);
  return Math.fround(Math.min(c.tripMax, Math.max(0, p)));
}

/** `vault` command: starts the vault over the nearest fence / through the nearest window. */
export function startVault(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
): CommandRejectReason | undefined {
  const b = body(w, eid);
  if (!b || b.kind !== 'player' || !canAct(b.state) || b.stair) return 'invalid-state';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  const { Position, Collider, Velocity } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const e = findEdge(w, grid, x, y, z);
  if (!e) return 'invalid-target';
  const cfg = w.physics.cfg.vault;
  const r = Math.min(Collider.radius[eid] ?? 0.3, 0.45);
  const land = Math.max(cfg.landTiles, r + 0.05);
  const lo = (e.dx !== 0 ? e.ty : e.tx) + r + 0.02;
  const along = Math.min(Math.max(e.dx !== 0 ? y : x, lo), lo + 1 - 2 * (r + 0.02));
  const toX = e.dx !== 0 ? e.line + e.dx * land : along;
  const toY = e.dx !== 0 ? along : e.line + e.dy * land;
  if (!fits(grid, z, e.tx, e.ty, toX, toY, r)) return 'invalid-target';

  b.vaultTrip = tripChance(w, eid, b, e.kind);
  b.vaultGlass = e.glass ? 1 : 0;
  b.vaultFromX = Math.fround(x);
  b.vaultFromY = Math.fround(y);
  b.vaultToX = Math.fround(toX);
  b.vaultToY = Math.fround(toY);
  b.vel = { x: 0, y: 0 };
  b.maxSpeed = 0;
  b.accel = 0;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  setState(b, 'vault', w.tick, e.kind === OpeningKind.fence ? cfg.fenceTicks : cfg.windowTicks);
  return undefined;
}

/** Bodies in `vault`: move along the line; on the last tick land (trip / glass rolls). */
export function vaultSystem(
  w: SimWorld,
  eidOf: ReadonlyMap<number, number>,
  events: PhysicsEvent[],
): void {
  const pw = w.physics;
  const { Position } = w.c;
  for (const [sid, eid] of eidOf) {
    const b = pw.bodies.get(sid)!;
    if (b.state !== 'vault') continue;
    const t = w.tick - b.stateStartTick;
    if (t < b.stateDuration) {
      const k = t / b.stateDuration;
      b.x = Math.fround(b.vaultFromX + (b.vaultToX - b.vaultFromX) * k);
      b.y = Math.fround(b.vaultFromY + (b.vaultToY - b.vaultFromY) * k);
      Position.x[eid] = b.x;
      Position.y[eid] = b.y;
      continue;
    }
    landVault(w, eid, b, events);
  }
}

function landVault(w: SimWorld, eid: number, b: PhysicsBody, events: PhysicsEvent[]): void {
  const pw = w.physics;
  const cfg = pw.cfg.vault;
  b.x = b.vaultToX;
  b.y = b.vaultToY;
  w.c.Position.x[eid] = b.x;
  w.c.Position.y[eid] = b.y;
  const u1 = pw.rng.nextFloat();
  const u2 = pw.rng.nextFloat();
  const u3 = pw.rng.nextFloat();
  // TODO(openings): skip the cut once windows have a "glass cleared" state.
  if (b.vaultGlass && u2 < cfg.glassChance && w.survival) {
    const part =
      GLASS_PARTS[Math.min(GLASS_PARTS.length - 1, Math.floor(u3 * GLASS_PARTS.length))]!;
    inflictWound(w, eid, part, woundKindIndex('laceration'));
  }
  const tripped = u1 < b.vaultTrip;
  b.vaultFromX = b.vaultFromY = b.vaultToX = b.vaultToY = b.vaultTrip = 0;
  b.vaultGlass = 0;
  if (tripped) {
    setState(b, 'knockdown', w.tick, cfg.tripKnockdownTicks);
    events.push({ type: 'tripped', entityId: b.id, tick: w.tick });
    events.push({ type: 'fellDown', entityId: b.id, tick: w.tick });
  } else {
    setState(b, 'idle', w.tick);
    events.push({ type: 'vaulted', entityId: b.id, tick: w.tick });
  }
}
