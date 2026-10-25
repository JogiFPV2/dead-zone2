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
  only?: VaultTarget,
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
    if (only && (only.side !== side || only.tx !== ex || only.ty !== ey)) continue;
    const id = side === 0 ? grid.edgeN(ex, ey, z) : grid.edgeW(ex, ey, z);
    const kind = grid.kindOf(id);
    if (kind !== OpeningKind.fence && kind !== OpeningKind.window) continue;
    const e = w.openings.states.get(openingKey(side, ex, ey, z));
    const state = e?.state ?? OS.closed;
    const ok =
      kind === OpeningKind.fence
        ? state === OS.closed
        : (state === OS.open || state === OS.broken) && !e?.planks;
    if (!ok) continue;
    bestD = d;
    best = {
      kind,
      // Shards left in a broken frame (`removeGlass` clears them).
      glass: kind === OpeningKind.window && state === OS.broken && !e?.cleared,
      line: side === 0 ? ey : ex,
      dx,
      dy,
      tx: tx + dx,
      ty: ty + dy,
    };
  }
  return best;
}

/** Squared distance from (px, py) to segment a–b. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l = vx * vx + vy * vy;
  const t = l > 0 ? Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / l)) : 0;
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

/** Why a circle of radius r at (x, y) in tile (tx, ty) cannot stand there (undefined = fits). */
export type VaultSpotIssue = 'no-floor' | 'furniture' | 'wall' | 'segment' | 'blocker';

/**
 * A circle of radius r at (x, y) in tile (tx, ty): floor, no furniture on the tile (footprint),
 * no blocking tile edge, exact wall segment (slanted walls, docs 9.63) or static blocker within r.
 */
export function spotIssue(
  grid: TileGrid,
  z: number,
  tx: number,
  ty: number,
  x: number,
  y: number,
  r: number,
): VaultSpotIssue | undefined {
  if (!hasFloor(grid, tx, ty, z)) return 'no-floor';
  if (grid.furnitureBlocks(tx, ty, z)) return 'furniture';
  if (
    (y - ty < r && grid.hasWallN(tx, ty, z)) ||
    (ty + 1 - y < r && grid.hasWallN(tx, ty + 1, z)) ||
    (x - tx < r && grid.hasWallW(tx, ty, z)) ||
    (tx + 1 - x < r && grid.hasWallW(tx + 1, ty, z))
  )
    return 'wall';
  let seg = false;
  grid.forSegments(x - r, y - r, x + r, y + r, z, (_k, ax, ay, bx, by) => {
    if (segDist2(x, y, ax, ay, bx, by) < r * r) seg = true;
  });
  if (seg) return 'segment';
  let blk = false;
  grid.forBlockers(x - r, y - r, x + r, y + r, z, (_k, bx0, bx1, by0, by1) => {
    const dx = Math.max(bx0 - x, 0, x - bx1);
    const dy = Math.max(by0 - y, 0, y - by1);
    if (dx * dx + dy * dy < r * r) blk = true;
  });
  return blk ? 'blocker' : undefined;
}

/** Segments a–b and c–d cross (proper intersection, touching ends excluded). */
function crosses(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay);
  const d2 = o(cx, cy, dx, dy, bx, by);
  const d3 = o(ax, ay, bx, by, cx, cy);
  const d4 = o(ax, ay, bx, by, dx, dy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Extra landing depths (tiles past `landTiles`) and offsets along the edge, in try order. */
const LAND_DEPTH = [0, 0.15, 0.3] as const;
const LAND_ALONG = [0, 0.15, -0.15, 0.3, -0.3] as const;

/**
 * Landing point beyond edge `e` for a body at (x, y) of radius r: the spot `landTiles` straight
 * past the edge, or, when that one does not fit (a slanted wall's exact segment next to the
 * raster window, docs 9.63: the gap is a little off the tile edge), the first fitting spot a bit
 * deeper / to the side, in a fixed order. The straight path from (x, y) must not cross a wall
 * segment (it goes through the gap). Undefined = nowhere to land; `issue` = why the first failed.
 */
function landingOf(
  grid: TileGrid,
  z: number,
  e: VaultEdge,
  x: number,
  y: number,
  r: number,
  landTiles: number,
): { x: number; y: number } | VaultSpotIssue {
  const land = Math.max(landTiles, r + 0.05);
  const lo = (e.dx !== 0 ? e.ty : e.tx) + r + 0.02;
  const hi = lo + 1 - 2 * (r + 0.02);
  const base = Math.min(Math.max(e.dx !== 0 ? y : x, lo), hi);
  let first: VaultSpotIssue | undefined;
  for (const dd of LAND_DEPTH)
    for (const da of LAND_ALONG) {
      const along = Math.min(Math.max(base + da, lo), hi);
      const depth = Math.min(land + dd, 1 - r - 0.02);
      const tx = e.dx !== 0 ? e.line + e.dx * depth : along;
      const ty = e.dx !== 0 ? along : e.line + e.dy * depth;
      let issue = spotIssue(grid, z, e.tx, e.ty, tx, ty, r);
      if (!issue) {
        let cut = false;
        grid.forSegments(
          Math.min(x, tx),
          Math.min(y, ty),
          Math.max(x, tx),
          Math.max(y, ty),
          z,
          (_k, ax, ay, bx, by) => {
            if (crosses(x, y, tx, ty, ax, ay, bx, by)) cut = true;
          },
        );
        if (!cut) return { x: tx, y: ty };
        issue = 'segment';
      }
      first ??= issue;
    }
  return first ?? 'wall';
}

/** Why one side of a window cannot be climbed through (undefined = it can). */
export type WindowPassIssue = `from-${VaultSpotIssue}` | `to-${VaultSpotIssue}` | 'no-opening';

/**
 * Geometry probe of one window edge (side 0 = n, 1 = w; edge of tile (ex, ey)) climbed from the
 * tile on the `fromLow` side (n / w tile when true): can a body of radius r stand in reach in front
 * of it (centred on the window) and land beyond it. Same landing rule as `startVault`; the opening
 * state is not checked (an open / broken window without planks). Used by the all-windows map test.
 */
export function windowPassIssue(
  w: SimWorld,
  grid: TileGrid,
  side: number,
  ex: number,
  ey: number,
  z: number,
  fromLow: boolean,
  r = 0.3,
): WindowPassIssue | undefined {
  const id = side === 0 ? grid.edgeN(ex, ey, z) : grid.edgeW(ex, ey, z);
  if (grid.kindOf(id) !== OpeningKind.window) return 'no-opening';
  const s = fromLow ? -1 : 1;
  const dx = side === 1 ? -s : 0;
  const dy = side === 0 ? -s : 0;
  const ftx = side === 1 ? (fromLow ? ex - 1 : ex) : ex;
  const fty = side === 0 ? (fromLow ? ey - 1 : ey) : ey;
  const line = side === 0 ? ey : ex;
  const e: VaultEdge = {
    kind: OpeningKind.window,
    glass: false,
    line,
    dx,
    dy,
    tx: ftx + dx,
    ty: fty + dy,
  };
  const reach = w.physics.cfg.vault.reachTiles;
  // Where the player could stand in front (closest first, centred first): first fit + landing.
  let fromIssue: VaultSpotIssue | undefined;
  let toIssue: VaultSpotIssue | undefined;
  for (const off of [r + 0.05, r + 0.2, reach - 0.02])
    for (const da of [0, 0.15, -0.15]) {
      const fx = side === 1 ? line - dx * off : ex + 0.5 + da;
      const fy = side === 0 ? line - dy * off : ey + 0.5 + da;
      const from = spotIssue(grid, z, ftx, fty, fx, fy, r);
      if (from) {
        fromIssue ??= from;
        continue;
      }
      const to = landingOf(grid, z, e, fx, fy, r, w.physics.cfg.vault.landTiles);
      if (typeof to !== 'string') return undefined;
      toIssue ??= to;
    }
  return toIssue ? `to-${toIssue}` : `from-${fromIssue ?? 'wall'}`;
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

/** A specific edge to vault (`climbThrough {tx, ty, side}`); side 0 = n, 1 = w. */
export interface VaultTarget {
  side: number;
  tx: number;
  ty: number;
}

/** Whether `startVault` would start now (no state change). */
export const canVault = (
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  only?: VaultTarget,
): CommandRejectReason | undefined => startVault(w, grid, eid, only, true);

/**
 * `vault` command: starts the vault over the nearest fence / through the nearest window (`only`:
 * just that edge, `climbThrough`). `dry`: only checks.
 */
export function startVault(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  only?: VaultTarget,
  dry = false,
): CommandRejectReason | undefined {
  const b = body(w, eid);
  if (!b || b.kind !== 'player' || !canAct(b.state) || b.stair) return 'invalid-state';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  const { Position, Collider, Velocity } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const e = findEdge(w, grid, x, y, z, only);
  if (!e) return 'invalid-target';
  const cfg = w.physics.cfg.vault;
  const r = Math.min(Collider.radius[eid] ?? 0.3, 0.45);
  const to = landingOf(grid, z, e, x, y, r, cfg.landTiles);
  if (typeof to === 'string') return 'invalid-target';
  const toX = to.x;
  const toY = to.y;
  if (dry) return undefined;

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
  // Shards in the frame: a cut (`openings.window.climbLacerationShare`) or a scratch.
  if (b.vaultGlass && u2 < cfg.glassChance && w.survival) {
    const part =
      GLASS_PARTS[Math.min(GLASS_PARTS.length - 1, Math.floor(u3 * GLASS_PARTS.length))]!;
    const deep = u2 < cfg.glassChance * w.openings.cfg.window.climbLacerationShare;
    inflictWound(w, eid, part, woundKindIndex(deep ? 'laceration' : 'scratch'));
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
