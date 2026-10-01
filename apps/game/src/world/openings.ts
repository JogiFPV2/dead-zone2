import type { EdgeSide, OpeningState, OpeningView, SimEvent } from '@deadzone/protocol';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { placeholderMaterial } from '../lighting/materials.js';
import type { BuildingLookup } from './building-lookup.js';
import type { ChunkRange, ChunkSource } from './chunk.js';
import { NO_CUTAWAY, isEdgeLowered, type Cutaway } from './cutaway.js';
import { LEVEL_HEIGHT } from './instances.js';
import { LOWERED_HEIGHT, WINDOW_HEIGHT, WALL_HEIGHT, collectEdges } from './structure-instances.js';

export type OpeningKind = 'door' | 'window' | 'fence';

/** Grey-box sizes (world units). */
const DOOR = { width: 0.9, height: 2.1, thickness: 0.06 };
const PANE = { thickness: 0.04, top: WALL_HEIGHT - 0.25 };
const FENCE = { height: 1, thickness: 0.07 };
const COLORS: Record<OpeningKind, string> = {
  door: '#5a4636',
  window: '#9fb2bf',
  fence: '#7a6146',
};

/**
 * Shake under crowd pressure (`openingPressure.level` 1..3): amplitude (rad, around the hinge /
 * the bottom edge) and frequency (Hz) per level; level 0 = still.
 */
export const PRESSURE_SHAKE = [
  { amp: 0, hz: 0 },
  { amp: 0.025, hz: 5 },
  { amp: 0.055, hz: 7.5 },
  { amp: 0.1, hz: 10 },
] as const;

/** One door / window / fence edge of the map (sim edge address + building for the cutaway). */
export interface OpeningEdge {
  kind: OpeningKind;
  tx: number;
  ty: number;
  z: number;
  side: EdgeSide;
  building: number;
}

export const openingKey = (tx: number, ty: number, z: number, side: EdgeSide): string =>
  `${tx},${ty},${z},${side}`;

/** Small stable hash (phase / fall direction per edge, no randomness). */
function hash(tx: number, ty: number, side: EdgeSide): number {
  let h = Math.imul(tx * 73856093 + ty * 19349663 + (side === 'n' ? 1 : 2), 0x9e3779b1);
  h ^= h >>> 15;
  return (h >>> 0) / 0xffffffff;
}

/**
 * Pose of an opening piece for `state` and shake angle `shake` (rad): a centred unit box scaled to the piece and placed on its edge. Pure (tests).
 * - door: leaf hinged at the edge start; `open` swings 90°, `broken` lies flat on the floor;
 * - window: glass pane over the sill; `open` / `broken` hide it;
 * - fence: one panel; `broken` (knocked over by a crowd) lies flat on the ground.
 * `lowered` (cutaway) cuts doors / panes / fences down to the lowered wall height.
 */
export function openingMatrix(
  out: Matrix4,
  e: OpeningEdge,
  state: OpeningState,
  shake: number,
  lowered: boolean,
): Matrix4 {
  const baseY = e.z * LEVEL_HEIGHT;
  // Along-edge unit vector and edge start in world (x = sim x, z = sim y).
  const along = e.side === 'n' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const normal = e.side === 'n' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const start = new Vector3(e.tx, baseY, e.ty);
  const yawAlong = e.side === 'n' ? 0 : -Math.PI / 2;
  const q = new Quaternion();
  const pos = new Vector3();
  const scale = new Vector3();
  const tmp = new Quaternion();
  const fallDir = hash(e.tx, e.ty, e.side) < 0.5 ? 1 : -1;
  if (e.kind === 'door') {
    const h = lowered ? LOWERED_HEIGHT : DOOR.height;
    scale.set(DOOR.width, h, DOOR.thickness);
    const hinge = start.clone().addScaledVector(along, (1 - DOOR.width) / 2);
    if (state === 'broken') {
      // Smashed leaf on the floor in front of the frame.
      scale.set(DOOR.width, DOOR.thickness, Math.min(h, DOOR.height));
      pos.copy(hinge).addScaledVector(along, DOOR.width / 2);
      pos.addScaledVector(normal, (fallDir * DOOR.height) / 2);
      pos.y = baseY + DOOR.thickness / 2;
      q.setFromAxisAngle(new Vector3(0, 1, 0), yawAlong);
      return out.compose(pos, q, scale);
    }
    const swing = state === 'open' ? (Math.PI / 2) * fallDir : shake;
    q.setFromAxisAngle(new Vector3(0, 1, 0), yawAlong + swing);
    // Leaf centre: half a width from the hinge along the swung direction.
    const dir = along.clone().applyAxisAngle(new Vector3(0, 1, 0), swing);
    pos.copy(hinge).addScaledVector(dir, DOOR.width / 2);
    pos.y = baseY + h / 2;
    return out.compose(pos, q, scale);
  }
  if (e.kind === 'window') {
    const hidden = state === 'open' || state === 'broken' || lowered;
    const h = hidden ? 0 : PANE.top - WINDOW_HEIGHT;
    scale.set(hidden ? 0 : 1, h, PANE.thickness);
    pos
      .copy(start)
      .addScaledVector(along, 0.5)
      .setY(baseY + WINDOW_HEIGHT + h / 2);
    pos.addScaledVector(normal, Math.sin(shake) * 0.05);
    q.setFromAxisAngle(new Vector3(0, 1, 0), yawAlong);
    return out.compose(pos, q, scale);
  }
  // Fence panel: tilts around its bottom edge (shake), flat on the ground when broken.
  const h = lowered ? Math.min(LOWERED_HEIGHT, FENCE.height) : FENCE.height;
  scale.set(1, h, FENCE.thickness);
  const tilt = state === 'broken' ? (fallDir * Math.PI) / 2 : shake;
  q.setFromAxisAngle(new Vector3(0, 1, 0), yawAlong);
  tmp.setFromAxisAngle(along, -tilt);
  q.premultiply(tmp);
  // Bottom edge stays on the edge line: centre = base + rotated half-height up vector.
  const up = new Vector3(0, h / 2, 0).applyQuaternion(tmp);
  pos.copy(start).addScaledVector(along, 0.5).add(up);
  if (state === 'broken') pos.y = baseY + FENCE.thickness / 2;
  return out.compose(pos, q, scale);
}

interface Group3 {
  mesh: InstancedMesh;
  edges: OpeningEdge[];
}

/**
 * Doors, window panes and fences as separate pieces (one InstancedMesh per kind): state from the
 * sim views (`openings`) and `openingChanged`, shake from `openingPressure` (level 0..3).
 */
export class OpeningsView {
  readonly root = new Group();
  /** Centred unit box. */
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly groups = new Map<OpeningKind, Group3>();
  private readonly index = new Map<string, { kind: OpeningKind; i: number }>();
  private readonly states = new Map<string, OpeningState>();
  private readonly pressure = new Map<string, number>();
  private cutaway: Cutaway = NO_CUTAWAY;
  private readonly m = new Matrix4();
  private dirty = true;

  constructor(
    private readonly source: ChunkSource,
    private readonly lookup: BuildingLookup,
  ) {
    this.root.name = 'openings';
  }

  /** Collects every door / window / fence edge in `range`. */
  loadRange(range: ChunkRange): void {
    const lists: Record<OpeningKind, OpeningEdge[]> = { door: [], window: [], fence: [] };
    const kindOf = (id: number) => this.source.edgePalette?.[id]?.kind;
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const chunk = this.source.getChunk(cx, cy, range.z);
        if (!chunk) continue;
        for (const g of collectEdges(chunk, kindOf, this.lookup, (k) => k !== 'wall')) {
          const kind = g.kind as OpeningKind;
          for (const e of g.edges) {
            lists[kind].push({
              kind,
              tx: e.tx,
              ty: e.ty,
              z: range.z,
              side: e.axis === 'N' ? 'n' : 'w',
              building: e.building,
            });
          }
        }
      }
    }
    for (const kind of ['door', 'window', 'fence'] as const) {
      const edges = lists[kind];
      if (edges.length === 0) continue;
      const mesh = new InstancedMesh(
        this.geometry,
        placeholderMaterial(COLORS[kind]),
        edges.length,
      );
      mesh.name = `openings:${kind}`;
      mesh.castShadow = kind !== 'window';
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      edges.forEach((e, i) => this.index.set(openingKey(e.tx, e.ty, e.z, e.side), { kind, i }));
      this.groups.set(kind, { mesh, edges });
      this.root.add(mesh);
    }
    this.dirty = true;
  }

  /** Edges of a kind (tests, dev). */
  edges(kind: OpeningKind): readonly OpeningEdge[] {
    return this.groups.get(kind)?.edges ?? [];
  }

  state(tx: number, ty: number, z: number, side: EdgeSide): OpeningState {
    return this.states.get(openingKey(tx, ty, z, side)) ?? 'closed';
  }

  pressureLevel(tx: number, ty: number, z: number, side: EdgeSide): number {
    return this.pressure.get(openingKey(tx, ty, z, side)) ?? 0;
  }

  /** Full list from the view (edges not listed are back to `closed`). */
  setStates(list: readonly OpeningView[]): void {
    this.states.clear();
    for (const o of list) this.states.set(openingKey(o.tx, o.ty, o.z, o.side), o.state);
    this.dirty = true;
  }

  /** `openingChanged` / `openingPressure` events. */
  applyEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'openingChanged') {
        this.states.set(openingKey(e.tx, e.ty, e.z, e.side), e.state);
        if (e.state !== 'closed' && e.state !== 'locked' && e.state !== 'barricaded') {
          this.pressure.delete(openingKey(e.tx, e.ty, e.z, e.side));
        }
        this.dirty = true;
      } else if (e.type === 'openingPressure') {
        const key = openingKey(e.tx, e.ty, e.z, e.side);
        const level = Math.max(0, Math.min(3, Math.round(e.level)));
        if (level === 0) this.pressure.delete(key);
        else this.pressure.set(key, level);
        this.dirty = true;
      }
    }
  }

  setCutaway(c: Cutaway): void {
    this.cutaway = c;
    this.dirty = true;
  }

  /** Writes the pieces; every frame only while something shakes. `nowS`: seconds. */
  update(nowS: number): void {
    if (!this.dirty && this.pressure.size === 0) return;
    this.dirty = false;
    for (const { mesh, edges } of this.groups.values()) {
      edges.forEach((e, i) => {
        const key = openingKey(e.tx, e.ty, e.z, e.side);
        const level = this.pressure.get(key) ?? 0;
        const s = PRESSURE_SHAKE[level] ?? PRESSURE_SHAKE[0];
        const phase = hash(e.tx, e.ty, e.side) * Math.PI * 2;
        const t = nowS * s.hz * Math.PI * 2 + phase;
        // Two sines: an irregular rattle instead of a clean wobble.
        const shake = s.amp * (0.7 * Math.sin(t) + 0.3 * Math.sin(t * 2.3 + 1.7));
        const axis = e.side === 'n' ? 'N' : 'W';
        const lowered = isEdgeLowered(this.cutaway, e.building, axis, e.tx, e.ty);
        openingMatrix(this.m, e, this.states.get(key) ?? 'closed', shake, lowered);
        mesh.setMatrixAt(i, this.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const { mesh } of this.groups.values()) (mesh.material as { dispose(): void }).dispose();
    this.root.clear();
  }
}
