import type {
  EdgeSide,
  OpeningState,
  OpeningView,
  SimEvent,
  WindowCoverView,
} from '@deadzone/protocol';
import { DOOR_MARK_B } from '../render/painted-buildings.js';
import {
  AdditiveBlending,
  BatchedMesh,
  BoxGeometry,
  DataTexture,
  DoubleSide,
  LinearFilter,
  MeshBasicMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Texture,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { TownKit } from './town/kit.js';
import { LEAF, SASH, SASH_SHOP } from './town/door-models.js';
import { placeholderMaterial } from '../lighting/materials.js';
import { coverLook, coverMaterial, coverMatrix } from './window-cover-look.js';
import type { BuildingLookup } from './building-lookup.js';
import type { ChunkRange, ChunkSource } from './chunk.js';
import { NO_CUTAWAY, isEdgeLowered, isLevelHidden, type Cutaway } from './cutaway.js';
import { LEVEL_HEIGHT } from './instances.js';
import { LOWERED_HEIGHT, WINDOW_HEIGHT, WALL_HEIGHT, collectEdges } from './structure-instances.js';

/** Batch colour of a door leaf (white to the eye, marks it for the painted door glow). */
const DOOR_MARK = new Color(1, 1, DOOR_MARK_B);

export type OpeningKind = 'door' | 'window' | 'fence' | 'gate';
const KINDS = ['door', 'window', 'fence', 'gate'] as const;

/** Grey-box sizes (world units). */
const DOOR = { width: 0.9, height: 2.1, thickness: 0.06 };
const PANE = { thickness: 0.04, top: WALL_HEIGHT - 0.25 };
const FENCE = { height: 1, thickness: 0.07 };
const COLORS: Record<OpeningKind, string> = {
  door: '#5a4636',
  window: '#9fb2bf',
  fence: '#7a6146',
  gate: '#6b5640',
};
const PLANK_COLOR = '#8a6a44';
const SHARD_COLOR = '#b9cad4';
/**
 * Plank: length along the edge (overhangs the frame), height, thickness. Centred on the edge
 * line and thicker than the wall, so the boards show on both faces (inside and out).
 */
const PLANK = { length: 1.12, height: 0.16, thickness: 0.22 };

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
  if (e.kind === 'gate') {
    // Fence-high leaf hinged at the edge start, a full tile wide; swings 90° like a door.
    const h = lowered ? Math.min(LOWERED_HEIGHT, FENCE.height) : FENCE.height;
    scale.set(0.96, h, FENCE.thickness);
    const swing = state === 'open' ? (Math.PI / 2) * fallDir : shake;
    q.setFromAxisAngle(new Vector3(0, 1, 0), yawAlong + swing);
    const dir = along.clone().applyAxisAngle(new Vector3(0, 1, 0), swing);
    pos.copy(start).addScaledVector(along, 0.02).addScaledVector(dir, 0.48);
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

/** Door leaf model: hinge at the origin, closed leaf along +X (0 … 0.84), 2.1 high. */
const KIT_LEAF = { width: 0.84, height: 2.1 };
/** Fence panel model `prop-fence`: centred, 1.9 long along X, 1.08 high. */
const KIT_FENCE = { length: 1.9, height: 1.08 };

/**
 * Where an opening sits when it is not on its tile edge: exterior doors / windows of slanted
 * (vector-walled) buildings are set into the gap of the outline wall (`OutlineOpening`).
 * `x`, `z`: centre of the gap; `rotY`: rotation of the edge module (local +x along the wall);
 * `width`: gap width (the 1 m module is stretched to it).
 */
export interface OpeningPlace {
  x: number;
  z: number;
  rotY: number;
  width: number;
}

/** Extra pose input of `kitOpeningMatrix`. */
export interface KitPose {
  /** Placement on a slanted outline; absent = the tile edge. */
  place?: OpeningPlace;
  /**
   * Side of the building's inside along the module's local +z (+1 / -1; 0 = unknown): opened
   * window sashes swing in.
   */
  inside?: number;
  /** Window sash model width (m, hinge at its local origin). */
  sashWidth?: number;
}

/**
 * Pose of a town-kit piece (door leaf / window sash / fence panel model, no box scaling). Same
 * states as `openingMatrix`: open doors swing 90°, broken ones lie on the floor, broken fences
 * lie flat, shake = rattle angle, `lowered` squashes the piece to the cutaway height. A window
 * sash shows only while the window is `open` (swung 80° into the room; the wall module drops its
 * glass then). Pure (tests).
 */
export function kitOpeningMatrix(
  out: Matrix4,
  e: OpeningEdge,
  state: OpeningState,
  shake: number,
  lowered: boolean,
  pose: KitPose = {},
): Matrix4 {
  const baseY = e.z * LEVEL_HEIGHT;
  const p = pose.place;
  const yaw0 = p ? p.rotY : e.side === 'n' ? 0 : -Math.PI / 2;
  // Local +x of the module (along the wall) in world x / z.
  const along = new Vector3(Math.cos(yaw0), 0, -Math.sin(yaw0));
  const centre = p
    ? new Vector3(p.x, baseY, p.z)
    : new Vector3(e.tx, baseY, e.ty).addScaledVector(along, 0.5);
  const stretch = p ? p.width : 1;
  const fallDir = hash(e.tx, e.ty, e.side) < 0.5 ? 1 : -1;
  const up = new Vector3(0, 1, 0);
  const local = new Vector3(1, 0, 0);
  const q = new Quaternion();
  const tilt = new Quaternion();
  if (e.kind === 'window') {
    const w = pose.sashWidth ?? 0.9;
    if (state !== 'open' || lowered) return out.makeScale(0, 0, 0);
    // +90° swings the free end towards local -z: pick the sign that points inside.
    const dir = (pose.inside ?? 0) > 0 ? -1 : 1;
    const pos = centre.clone().addScaledVector(along, (-w / 2) * stretch);
    q.setFromAxisAngle(up, yaw0 + (dir * (80 * Math.PI)) / 180);
    return out.compose(pos, q, new Vector3(stretch, 1, 1));
  }
  if (e.kind === 'door') {
    const sy = lowered ? LOWERED_HEIGHT / KIT_LEAF.height : 1;
    const pos = centre.clone().addScaledVector(along, (-KIT_LEAF.width / 2) * stretch);
    const sx = stretch;
    if (state === 'broken') {
      q.setFromAxisAngle(up, yaw0);
      tilt.setFromAxisAngle(local, (fallDir * Math.PI) / 2);
      q.multiply(tilt);
      pos.y += 0.12;
      return out.compose(pos, q, new Vector3(sx, Math.min(sy, 1), 1));
    }
    const swing = state === 'open' ? (Math.PI / 2) * fallDir : shake;
    q.setFromAxisAngle(up, yaw0 + swing);
    return out.compose(pos, q, new Vector3(sx, sy, 1));
  }
  const start = centre.clone().addScaledVector(along, -0.5 * stretch);
  if (e.kind === 'gate') {
    // Fence panel model as a gate leaf: hinged at the edge start, swings 90° when open.
    const sy = lowered ? Math.min(1, LOWERED_HEIGHT / KIT_FENCE.height) : 1;
    const swing = state === 'open' ? (Math.PI / 2) * fallDir : shake;
    q.setFromAxisAngle(up, yaw0 + swing);
    const dir = along.clone().applyAxisAngle(up, swing);
    const pos = start.addScaledVector(dir, 0.5 * stretch);
    return out.compose(pos, q, new Vector3(stretch / KIT_FENCE.length, sy, 1));
  }
  // Fence panel, tilting around its bottom edge.
  const sy = lowered ? Math.min(1, LOWERED_HEIGHT / KIT_FENCE.height) : 1;
  const angle = state === 'broken' ? (fallDir * Math.PI) / 2 : shake;
  q.setFromAxisAngle(up, yaw0);
  tilt.setFromAxisAngle(local, -angle);
  q.multiply(tilt);
  const pos = centre.clone();
  if (state === 'broken') pos.y += 0.08;
  return out.compose(pos, q, new Vector3(stretch / KIT_FENCE.length, sy, 1));
}

/** Height band (m above the floor) the planks of an edge kind cover. */
function plankBand(kind: OpeningKind): [number, number] {
  if (kind === 'window') return [WINDOW_HEIGHT + 0.1, PANE.top - 0.1];
  if (kind === 'door') return [0.35, DOOR.height - 0.3];
  return [0.15, FENCE.height - 0.15];
}

/**
 * Plank `i` (0..3) of `count` nailed over an edge: across the frame (both faces), spread over the kind's height band, alternately tilted a little. Hidden (zero scale) when
 * `i >= count` or above the cutaway height. Pure (tests).
 */
export function plankMatrix(
  out: Matrix4,
  e: OpeningEdge,
  i: number,
  count: number,
  lowered: boolean,
): Matrix4 {
  const [lo, hi] = plankBand(e.kind);
  const y = lo + ((hi - lo) * (i + 0.5)) / 4;
  if (i >= count || (lowered && y > LOWERED_HEIGHT)) return out.makeScale(0, 0, 0);
  const baseY = e.z * LEVEL_HEIGHT;
  const along = e.side === 'n' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const yawAlong = e.side === 'n' ? 0 : -Math.PI / 2;
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawAlong);
  const roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (i % 2 ? -1 : 1) * 0.14);
  q.multiply(roll);
  const pos = new Vector3(e.tx, baseY + y, e.ty).addScaledVector(along, 0.5);
  return out.compose(pos, q, new Vector3(PLANK.length, PLANK.height, PLANK.thickness));
}

/**
 * Glass shards left in a broken window frame (`glass: true`): a jagged strip on the sill (i 0)
 * and under the lintel (i 1); hidden otherwise. Pure (tests).
 */
export function shardMatrix(
  out: Matrix4,
  e: OpeningEdge,
  i: number,
  show: boolean,
  lowered: boolean,
): Matrix4 {
  if (!show || (lowered && i === 1)) return out.makeScale(0, 0, 0);
  const baseY = e.z * LEVEL_HEIGHT;
  const along = e.side === 'n' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const yawAlong = e.side === 'n' ? 0 : -Math.PI / 2;
  const h = i === 0 ? 0.14 : 0.09;
  const y = i === 0 ? WINDOW_HEIGHT + h / 2 : PANE.top - h / 2;
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawAlong);
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), i === 0 ? 0.06 : -0.05));
  const pos = new Vector3(e.tx, baseY + y, e.ty).addScaledVector(along, 0.5);
  return out.compose(pos, q, new Vector3(0.9, h, PANE.thickness));
}

/** Door glow through walls (Paweł 24.11): colour, reach and draw order. */
export const DOOR_GLOW_COLOR = new Color('#ffc978');
/** Full glow up to this distance (tiles = m), none past `DOOR_GLOW_FAR`. */
export const DOOR_GLOW_NEAR = 14;
export const DOOR_GLOW_FAR = 30;
/** Peak strength (additive share of `DOOR_GLOW_COLOR`): faint, a hint through walls. */
export const DOOR_GLOW_PEAK = 0.14;
/** Drawn after the world (no depth test: shows through walls and roofs). */
export const DOOR_GLOW_ORDER = 20;

/**
 * Glow strength of a door for a viewer (sim x / y, level z): only doors on the viewer's level,
 * `DOOR_GLOW_PEAK` up to `DOOR_GLOW_NEAR`, fading out by `DOOR_GLOW_FAR`. Pure (tests).
 */
export function doorGlowStrength(
  e: Pick<OpeningEdge, 'tx' | 'ty' | 'z' | 'side'>,
  v: { x: number; y: number; z: number },
): number {
  if (e.z !== v.z) return 0;
  const cx = e.side === 'n' ? e.tx + 0.5 : e.tx;
  const cy = e.side === 'n' ? e.ty : e.ty + 0.5;
  const d = Math.hypot(cx - v.x, cy - v.y);
  if (d >= DOOR_GLOW_FAR) return 0;
  const k = d <= DOOR_GLOW_NEAR ? 1 : 1 - (d - DOOR_GLOW_NEAR) / (DOOR_GLOW_FAR - DOOR_GLOW_NEAR);
  return DOOR_GLOW_PEAK * k * k * (3 - 2 * k);
}

let glowGeometry: BufferGeometry | undefined;
/** Door-sized card in the leaf's frame (hinge at the origin, along +x, up from the floor). */
export function doorGlowGeometry(): BufferGeometry {
  if (!glowGeometry) {
    // A little larger than the leaf: the soft edge falls on the frame.
    const g = new PlaneGeometry(LEAF.width + 0.2, LEAF.height + 0.16);
    g.translate(LEAF.width / 2, LEAF.height / 2, 0);
    glowGeometry = g;
  }
  return glowGeometry;
}

/** Soft rectangle (white middle, transparent rim) for the glow card. */
function glowTexture(): Texture {
  const w = 32;
  const h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ex = Math.min(x + 0.5, w - x - 0.5) / (w * 0.32);
      const ey = Math.min(y + 0.5, h - y - 0.5) / (h * 0.16);
      const k = Math.min(1, ex) * Math.min(1, ey);
      const v = Math.round(255 * k * k * (3 - 2 * k));
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  const t = new DataTexture(data, w, h);
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

let glowMaterial: MeshBasicMaterial | undefined;
/** Shared additive, depth-test-free material of the door glow (instance colour = strength). */
export function doorGlowMaterial(): MeshBasicMaterial {
  if (!glowMaterial) {
    glowMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      map: glowTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    glowMaterial.name = 'openings/door-glow';
  }
  return glowMaterial;
}

/** The wall module of a window drops its glass while open (sash swung in) or smashed. */
export const windowWithoutGlass = (state: OpeningState): boolean =>
  state === 'broken' || state === 'open';

/** Sash model for a window module kind (`windowKind`): witryna or a plain window. */
export const sashModel = (kind: 'shop' | 'window' | undefined): string | undefined =>
  kind === 'shop' ? SASH_SHOP : kind === 'window' ? SASH : undefined;

/** Town look of the opening pieces: kit models in one BatchedMesh (windows are wall modules). */
export interface OpeningsKit {
  kit: TownKit;
  /** Leaf model for a door edge (by building skin). */
  leafOf(e: OpeningEdge): string;
  /** Window state changes (the glass lives in the wall module). */
  onWindow?(e: OpeningEdge, state: OpeningState): void;
  /** Sash model of an opened window (`SASH` / `SASH_SHOP`); absent = windows get no sash. */
  sashOf?(e: OpeningEdge): string | undefined;
  /** Placement on a slanted building's outline (exterior doors / windows), else the tile edge. */
  placeOf?(e: OpeningEdge): OpeningPlace | undefined;
}

interface Group3 {
  /** Grey-box pieces (no kit). */
  mesh?: InstancedMesh;
  edges: OpeningEdge[];
  /** Kit mode: instance ids in the shared BatchedMesh (windows: none). */
  ids?: number[];
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
  private readonly planks = new Map<string, number>();
  /** Windows whose frame has lost its glass (`removeGlass`); default: glass in the frame. */
  private readonly noGlass = new Set<string>();
  /** Window covers (protocol 47) by edge key, from the full `view.openings` list. */
  private readonly covers = new Map<string, WindowCoverView>();
  /** Every door / window / gate / fence edge (planks); windows (shards). */
  private plankMesh: InstancedMesh | undefined;
  private shardMesh: InstancedMesh | undefined;
  /** Covered windows (protocol 47): one panel per window edge, hidden when none is covered. */
  private coverMesh: InstancedMesh | undefined;
  private coverFx: InstancedBufferAttribute | undefined;
  /** Window edges (`openingKey`) whose room light is on (`view.litWindows`): covers glow. */
  private litKeys: ReadonlySet<string> = new Set();
  private plankEdges: OpeningEdge[] = [];
  private shardEdges: OpeningEdge[] = [];
  private readonly pressure = new Map<string, number>();
  private cutaway: Cutaway = NO_CUTAWAY;
  private readonly m = new Matrix4();
  private readonly coverColor = new Color();
  private dirty = true;

  private batch: BatchedMesh | undefined;
  /** Kit pose extras per edge (outline placement, inside side, sash width). */
  private readonly poses = new Map<OpeningEdge, KitPose>();
  /** Door glow through walls: leaf shapes drawn over everything, faded by distance. */
  private glow: InstancedMesh | undefined;
  private readonly glowIds = new Map<OpeningEdge, number>();
  private readonly glowShown = new Set<OpeningEdge>();
  private viewer: { x: number; y: number; z: number } | undefined;
  private readonly glowColor = new Color();

  constructor(
    private readonly source: ChunkSource,
    private readonly lookup: BuildingLookup,
    private readonly kit?: OpeningsKit,
  ) {
    this.root.name = 'openings';
  }

  /** Collects every door / window / fence edge in `range`. */
  loadRange(range: ChunkRange): void {
    const lists: Record<OpeningKind, OpeningEdge[]> = { door: [], window: [], fence: [], gate: [] };
    const kindOf = (id: number) => this.source.edgePalette?.[id]?.kind;
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const chunk = this.source.getChunk(cx, cy, range.z);
        if (!chunk) continue;
        for (const g of collectEdges(chunk, kindOf, this.lookup, (k) => k !== 'wall')) {
          const kind = g.kind as OpeningKind;
          if (!lists[kind]) continue;
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
    this.loadExtras(lists);
    if (this.kit) {
      this.loadKit(lists);
      this.dirty = true;
      return;
    }
    for (const kind of KINDS) {
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

  /** Planks (4 per edge) and window shards (2 per window): one InstancedMesh each. */
  private loadExtras(lists: Record<OpeningKind, OpeningEdge[]>): void {
    this.plankEdges = [...lists.door, ...lists.gate, ...lists.window, ...lists.fence];
    this.shardEdges = lists.window;
    if (this.plankEdges.length) {
      const m = new InstancedMesh(
        this.geometry,
        placeholderMaterial(PLANK_COLOR),
        this.plankEdges.length * 4,
      );
      m.name = 'openings:planks';
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      this.plankMesh = m;
      this.root.add(m);
    }
    if (this.shardEdges.length) {
      const m = new InstancedMesh(
        this.geometry,
        placeholderMaterial(SHARD_COLOR),
        this.shardEdges.length * 2,
      );
      m.name = 'openings:shards';
      m.frustumCulled = false;
      this.shardMesh = m;
      this.root.add(m);
      const c = new InstancedMesh(this.geometry, coverMaterial(), this.shardEdges.length);
      c.name = 'openings:covers';
      c.frustumCulled = false;
      c.visible = false;
      this.coverFx = new InstancedBufferAttribute(new Float32Array(this.shardEdges.length * 2), 2);
      c.geometry = this.geometry.clone();
      c.geometry.setAttribute('coverFx', this.coverFx);
      c.setColorAt(0, new Color());
      this.coverMesh = c;
      this.root.add(c);
    }
  }

  /** Kit mode: door leaves + fence panels in one BatchedMesh (1 draw call). */
  private loadKit(lists: Record<OpeningKind, OpeningEdge[]>): void {
    const kit = this.kit;
    if (!kit) return;
    const pieces: { kind: OpeningKind; e: OpeningEdge; model: string }[] = [];
    for (const e of lists.door) pieces.push({ kind: 'door', e, model: kit.leafOf(e) });
    for (const e of lists.fence) pieces.push({ kind: 'fence', e, model: 'prop-fence' });
    for (const e of lists.gate) pieces.push({ kind: 'gate', e, model: 'prop-fence' });
    // Every window gets its sash (hidden until opened): each one opens on its own.
    for (const e of lists.window) {
      const sash = kit.sashOf?.(e);
      pieces.push({ kind: 'window', e, model: sash ?? '' });
    }
    const modelOf = new Map(pieces.map((p) => [p.e, p.model]));
    for (const kind of KINDS)
      for (const e of lists[kind]) {
        const place = kit.placeOf?.(e);
        const model = modelOf.get(e);
        const sashWidth = model ? this.modelWidth(model) : undefined;
        this.poses.set(e, {
          ...(place ? { place } : {}),
          inside: this.insideSign(e, place),
          ...(sashWidth ? { sashWidth } : {}),
        });
      }
    const models = [...new Set(pieces.map((p) => p.model))].filter((m) =>
      kit.kit.geometries.has(m),
    );
    let verts = 0;
    let index = 0;
    for (const m of models) {
      const g = kit.kit.geometries.get(m);
      verts += g?.getAttribute('position').count ?? 0;
      index += g?.index?.count ?? 0;
    }
    for (const kind of KINDS) {
      const edges = lists[kind];
      edges.forEach((e, i) => this.index.set(openingKey(e.tx, e.ty, e.z, e.side), { kind, i }));
      if (edges.length) this.groups.set(kind, { edges, ids: [] });
    }
    if (!models.length) return;
    this.addGlow(pieces.filter((p) => p.kind === 'door' && kit.kit.geometries.has(p.model)));
    const batch = new BatchedMesh(Math.max(1, pieces.length), verts, index, kit.kit.material);
    batch.name = 'openings:kit';
    batch.castShadow = true;
    batch.receiveShadow = true;
    const ids = new Map(models.map((m) => [m, batch.addGeometry(kit.kit.geometries.get(m)!)]));
    for (const p of pieces) {
      const gid = ids.get(p.model);
      const g = this.groups.get(p.kind);
      if (!g?.ids) continue;
      if (gid === undefined) {
        // No model (e.g. no sash for this window): keeps the index of the group's edges.
        g.ids.push(-1);
        continue;
      }
      const id = batch.addInstance(gid);
      // Door leaves are marked for the painted style's soft door glow.
      if (p.kind === 'door') batch.setColorAt(id, DOOR_MARK);
      g.ids.push(id);
    }
    this.batch = batch;
    this.root.add(batch);
  }

  /** Width (m, along local +x) of a kit model, cached. */
  private modelWidth(model: string): number | undefined {
    const g = this.kit?.kit.geometries.get(model);
    if (!g) return undefined;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    return bb.max.x - Math.max(0, bb.min.x);
  }

  /**
   * Side of the building's inside along the module's local +z: the tile on that side of the
   * edge belongs to the edge's building (+1), the other one does (-1), else 0.
   */
  private insideSign(e: OpeningEdge, place?: OpeningPlace): number {
    // Tile on the +world side of the edge (south for a north edge, east for a west edge).
    const plus = this.lookup.at(e.tx, e.ty, e.z) === e.building;
    const minus =
      e.side === 'n'
        ? this.lookup.at(e.tx, e.ty - 1, e.z) === e.building
        : this.lookup.at(e.tx - 1, e.ty, e.z) === e.building;
    if (plus === minus) return 0;
    const s = plus ? 1 : -1;
    const nx = e.side === 'n' ? 0 : s;
    const nz = e.side === 'n' ? s : 0;
    // Local +z of the module as `kitOpeningMatrix` turns it.
    const yaw = place ? place.rotY : e.side === 'n' ? 0 : -Math.PI / 2;
    return nx * Math.sin(yaw) + nz * Math.cos(yaw) >= 0 ? 1 : -1;
  }

  /**
   * Door glow: one soft door-sized card per leaf (follows the leaf when it swings), additive and
   * without depth test, so it shows through walls. One flat card, not the leaf model: a model's
   * stacked faces would add up to a white blob.
   */
  private addGlow(doors: readonly { e: OpeningEdge; model: string }[]): void {
    if (!doors.length) return;
    const glow = new InstancedMesh(doorGlowGeometry(), doorGlowMaterial(), doors.length);
    glow.name = 'openings:door-glow';
    glow.renderOrder = DOOR_GLOW_ORDER;
    glow.castShadow = false;
    glow.receiveShadow = false;
    glow.frustumCulled = false;
    doors.forEach((d, id) => {
      glow.setColorAt(id, this.glowColor.setScalar(0));
      glow.setMatrixAt(id, this.m.makeScale(0, 0, 0));
      this.glowIds.set(d.e, id);
    });
    this.glow = glow;
    this.root.add(glow);
  }

  private glowAt(e: OpeningEdge, m: Matrix4 | undefined): void {
    const id = this.glowIds.get(e);
    if (id === undefined || !this.glow) return;
    if (m) this.glow.setMatrixAt(id, m);
    else this.glow.setMatrixAt(id, this.m.makeScale(0, 0, 0));
    if (m) this.glowShown.add(e);
    else this.glowShown.delete(e);
  }

  /** Strength of each door's glow from the viewer (player) position. */
  private updateGlowFade(): void {
    const glow = this.glow;
    if (!glow) return;
    const v = this.viewer;
    let any = false;
    for (const [e, id] of this.glowIds) {
      const a = v && this.glowShown.has(e) ? doorGlowStrength(e, v) : 0;
      if (a > 0) any = true;
      glow.setColorAt(id, this.glowColor.copy(DOOR_GLOW_COLOR).multiplyScalar(a));
    }
    glow.instanceMatrix.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    glow.visible = any;
  }

  /**
   * Player position (sim tiles x / y, level z): door glow fades with distance and shows on the
   * player's level only. Re-applied when the player moved half a tile or changed level.
   */
  setViewer(x: number, y: number, z: number): void {
    const v = this.viewer;
    if (v && v.z === z && Math.hypot(v.x - x, v.y - y) < 0.5) return;
    this.viewer = { x, y, z };
    if (this.glow) this.dirty = true;
  }

  /** Edges of a kind (tests, dev). */
  edges(kind: OpeningKind): readonly OpeningEdge[] {
    return this.groups.get(kind)?.edges ?? [];
  }

  state(tx: number, ty: number, z: number, side: EdgeSide): OpeningState {
    return this.states.get(openingKey(tx, ty, z, side)) ?? 'closed';
  }

  /** State, planks and glass of an edge (F targeting). */
  info(
    tx: number,
    ty: number,
    z: number,
    side: EdgeSide,
  ): { state: OpeningState; barricade: number; glass: boolean; cover?: WindowCoverView } {
    const key = openingKey(tx, ty, z, side);
    const cover = this.covers.get(key);
    return {
      state: this.states.get(key) ?? 'closed',
      barricade: this.planks.get(key) ?? 0,
      glass: !this.noGlass.has(key),
      ...(cover ? { cover } : {}),
    };
  }

  private setExtras(key: string, barricade: number | undefined, glass: boolean | undefined): void {
    if (barricade) this.planks.set(key, barricade);
    else this.planks.delete(key);
    if (glass === false) this.noGlass.add(key);
    else this.noGlass.delete(key);
  }

  pressureLevel(tx: number, ty: number, z: number, side: EdgeSide): number {
    return this.pressure.get(openingKey(tx, ty, z, side)) ?? 0;
  }

  /** Full list from the view (edges not listed are back to `closed`). */
  setStates(list: readonly OpeningView[]): void {
    this.states.clear();
    this.planks.clear();
    this.noGlass.clear();
    this.covers.clear();
    for (const o of list) {
      const key = openingKey(o.tx, o.ty, o.z, o.side);
      this.states.set(key, o.state);
      if (o.cover) this.covers.set(key, o.cover);
      this.setExtras(key, o.barricade, o.glass);
    }
    this.dirty = true;
    if (this.kit?.onWindow) {
      for (const e of this.edges('window'))
        this.kit.onWindow(e, this.state(e.tx, e.ty, e.z, e.side));
    }
  }

  /** `openingChanged` / `openingPressure` events. */
  applyEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'openingChanged') {
        this.states.set(openingKey(e.tx, e.ty, e.z, e.side), e.state);
        this.setExtras(openingKey(e.tx, e.ty, e.z, e.side), e.barricade, e.glass);
        const at = this.index.get(openingKey(e.tx, e.ty, e.z, e.side));
        if (at?.kind === 'window') {
          const edge = this.groups.get('window')?.edges[at.i];
          if (edge) this.kit?.onWindow?.(edge, e.state);
        }
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
    for (const [kind, { mesh, edges, ids }] of this.groups) {
      if (!mesh && !ids?.length) continue;
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
        const state = this.states.get(key) ?? 'closed';
        const hidden = isLevelHidden(this.cutaway, e.building, e.z);
        if (hidden) {
          // Storey above the player's floor in a cut building: not drawn.
          this.m.makeScale(0, 0, 0);
          if (mesh) mesh.setMatrixAt(i, this.m);
          else if (this.batch && ids?.[i] !== undefined && ids[i] >= 0)
            this.batch.setMatrixAt(ids[i], this.m);
        } else if (mesh) {
          openingMatrix(this.m, e, state, shake, lowered);
          mesh.setMatrixAt(i, this.m);
        } else if (this.batch && ids?.[i] !== undefined && ids[i] >= 0) {
          kitOpeningMatrix(this.m, e, state, shake, lowered, this.poses.get(e));
          this.batch.setMatrixAt(ids[i], this.m);
        }
        if (kind === 'door' && this.glow) {
          // Glow at full height even where the cutaway lowers the leaf: the door shows there.
          if (lowered && !hidden)
            kitOpeningMatrix(this.m, e, state, shake, false, this.poses.get(e));
          this.glowAt(e, hidden || state === 'broken' ? undefined : this.m);
        }
      });
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
    this.updateGlowFade();
    this.updateExtras();
  }

  private updateExtras(): void {
    const lowered = (e: OpeningEdge) =>
      isEdgeLowered(this.cutaway, e.building, e.side === 'n' ? 'N' : 'W', e.tx, e.ty) ||
      isLevelHidden(this.cutaway, e.building, e.z);
    // Meshes with nothing to show are hidden: no draw call (and no shadow pass) for empty batches.
    if (this.plankMesh) {
      let any = false;
      this.plankEdges.forEach((e, j) => {
        const n = this.planks.get(openingKey(e.tx, e.ty, e.z, e.side)) ?? 0;
        if (n > 0) any = true;
        const low = n > 0 && lowered(e);
        for (let i = 0; i < 4; i++)
          this.plankMesh!.setMatrixAt(j * 4 + i, plankMatrix(this.m, e, i, n, low));
      });
      this.plankMesh.instanceMatrix.needsUpdate = true;
      this.plankMesh.visible = any;
    }
    if (this.shardMesh) {
      let any = false;
      this.shardEdges.forEach((e, j) => {
        const key = openingKey(e.tx, e.ty, e.z, e.side);
        const show = this.states.get(key) === 'broken' && !this.noGlass.has(key);
        if (show) any = true;
        const low = show && lowered(e);
        for (let i = 0; i < 2; i++)
          this.shardMesh!.setMatrixAt(j * 2 + i, shardMatrix(this.m, e, i, show, low));
      });
      this.shardMesh.instanceMatrix.needsUpdate = true;
      this.shardMesh.visible = any;
    }
    this.updateCovers(lowered);
  }

  /** Lit room windows (`litWindowKeys`: `tx,ty,z,N|W`): their covers let `lightPass` glow out. */
  setLitWindows(keys: ReadonlySet<string>): void {
    const out = new Set<string>();
    for (const k of keys) {
      const [tx, ty, z, axis] = k.split(',');
      out.add(`${tx},${ty},${z},${axis === 'N' ? 'n' : 'w'}`);
    }
    this.litKeys = out;
    this.dirty = true;
  }

  private updateCovers(lowered: (e: OpeningEdge) => boolean): void {
    const mesh = this.coverMesh;
    const fx = this.coverFx;
    if (!mesh || !fx) return;
    let any = false;
    this.shardEdges.forEach((e, j) => {
      const key = openingKey(e.tx, e.ty, e.z, e.side);
      const cover = this.covers.get(key);
      const show = !!cover && !lowered(e);
      const look = cover ? coverLook(cover) : undefined;
      if (show) any = true;
      mesh.setMatrixAt(j, coverMatrix(this.m, e, look?.coverage ?? 0, show));
      if (look) {
        mesh.setColorAt(j, this.coverColor.setHex(look.color));
        fx.setXY(j, look.alpha, this.litKeys.has(key) ? look.glow : 0);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    fx.needsUpdate = true;
    mesh.visible = any;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const mesh of [
      ...[...this.groups.values()].map((g) => g.mesh),
      this.plankMesh,
      this.shardMesh,
    ]) {
      if (mesh) (mesh.material as { dispose(): void }).dispose();
    }
    // The cover material is shared by every view: only its per-view geometry goes.
    this.coverMesh?.geometry.dispose();
    this.batch?.dispose();
    this.glow?.dispose();
    this.root.clear();
  }
}
