import type { Box3 } from 'three';
import {
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Texture,
} from 'three';
import { CARD_GRID } from './window-card.js';

/** Glass opacity (bld-spec §4: ~0.35). */
export const GLASS_OPACITY = 0.35;
/** Interior card depth behind the glass (m, spec 0.3–0.5). */
export const CARD_DEPTH = 0.4;
/** Within this many tiles of the player the card hides and the real room shows (variant B). */
export const NEAR_TILES = 8;

const ZERO = new Matrix4().makeScale(0, 0, 0);
const FLIP = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const NO_TURN = new Quaternion();

/** One window: where it is (tile centre of the edge, sim x / y) and what shows. */
interface Slot {
  live: boolean;
  x: number;
  y: number;
  glass: boolean;
  card: boolean;
  near: boolean;
}

/** Card placement in module space: in front of / behind the glass, facing outward. */
export function cardLocal(box: Box3, inward: 1 | -1, out = new Matrix4()): Matrix4 {
  const c = box.getCenter(new Vector3());
  const s = box.getSize(new Vector3());
  return out.compose(
    new Vector3(c.x, c.y, c.z + inward * CARD_DEPTH),
    inward > 0 ? FLIP : NO_TURN,
    new Vector3(Math.max(s.x, 0.01), Math.max(s.y, 0.01), 1),
  );
}

/** Glass placement in module space (centre of the glass triangles' box). */
export function glassLocal(box: Box3, out = new Matrix4()): Matrix4 {
  const c = box.getCenter(new Vector3());
  const s = box.getSize(new Vector3());
  return out.compose(c, NO_TURN, new Vector3(Math.max(s.x, 0.01), Math.max(s.y, 0.01), 1));
}

function cardMaterial(atlas: Texture | undefined): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ color: '#ffffff', side: FrontSide });
  if (atlas) m.map = atlas;
  // Interior cards are opaque; bld detail decals (same material) cut their transparent pixels.
  m.alphaTest = 0.5;
  m.name = 'window-card';
  // Per-instance atlas cell (aCell): uv into the CARD_GRID² grid.
  m.onBeforeCompile = (p) => {
    p.vertexShader = p.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = (vMapUv + vec2(mod(aCell, ${CARD_GRID}.0), floor(aCell / ${CARD_GRID}.0))) / ${CARD_GRID}.0;
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'window-card';
  return m;
}

/**
 * Semi-transparent glass + interior cards (bld-spec §4): two InstancedMeshes, so +2 draw calls
 * whatever the window count. Streamed worlds share one between every chunk level (slots are
 * freed with `remove` and reused); the capacity grows on demand. Neither casts shadows (shadows unchanged:
 * the window module's frame still casts). Hidden instances get a zero matrix.
 */
export class WindowPanes {
  readonly root = new Group();
  readonly glass: InstancedMesh;
  readonly card: InstancedMesh;
  private readonly glassM: Matrix4[] = [];
  private readonly cardM: Matrix4[] = [];
  private readonly slots: Slot[] = [];
  private cells: Float32Array;
  private readonly free: number[] = [];
  private nearKey = '';
  private near: { px: number; py: number } | undefined;

  constructor(capacity: number, atlas: Texture | undefined) {
    const quad = new PlaneGeometry(1, 1);
    const glassMat = new MeshStandardMaterial({
      color: new Color('#9fb7c4'),
      transparent: true,
      opacity: GLASS_OPACITY,
      roughness: 0.08,
      metalness: 0.1,
      depthWrite: false,
      side: DoubleSide,
    });
    glassMat.name = 'window-glass';
    this.glass = new InstancedMesh(quad, glassMat, Math.max(1, capacity));
    this.card = new InstancedMesh(quad.clone(), cardMaterial(atlas), Math.max(1, capacity));
    this.cells = new Float32Array(Math.max(1, capacity));
    this.card.geometry.setAttribute('aCell', new InstancedBufferAttribute(this.cells, 1));
    for (const m of [this.glass, this.card]) {
      m.count = 0;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
    this.glass.name = 'window-glass';
    this.card.name = 'window-card';
    this.glass.renderOrder = 2;
    this.root.add(this.card, this.glass);
  }

  /** Windows drawn (live slots). */
  get size(): number {
    return this.slots.length - this.free.length;
  }

  private grow(need: number): void {
    const cap = this.cells.length;
    if (need <= cap) return;
    const next = Math.max(need, cap * 2);
    for (const m of [this.glass, this.card]) {
      const a = new InstancedBufferAttribute(new Float32Array(next * 16), 16);
      a.array.set(m.instanceMatrix.array);
      m.instanceMatrix = a;
    }
    const cells = new Float32Array(next);
    cells.set(this.cells);
    this.cells = cells;
    this.card.geometry.setAttribute('aCell', new InstancedBufferAttribute(cells, 1));
  }

  /** Frees slot `i` (its level unloaded). */
  remove(i: number): void {
    const s = this.slots[i];
    if (!s?.live) return;
    s.live = false;
    this.free.push(i);
    this.write(i);
  }

  /** Adds a window: module world matrix, glass box (module space), inward side, atlas cell. */
  add(module: Matrix4, box: Box3, inward: 1 | -1, cell: number, x: number, y: number): number {
    const reuse = this.free.pop();
    const i = reuse ?? this.slots.length;
    if (reuse === undefined) this.grow(i + 1);
    this.glassM[i] = module.clone().multiply(glassLocal(box));
    this.cardM[i] = module.clone().multiply(cardLocal(box, inward));
    this.cells[i] = cell;
    const n = this.near;
    const near = !!n && Math.abs(x - n.px) < NEAR_TILES && Math.abs(y - n.py) < NEAR_TILES;
    this.slots[i] = { live: true, x, y, glass: true, card: true, near };
    this.glass.count = this.card.count = this.slots.length;
    this.write(i);
    return i;
  }

  /** What a window shows (glass pane / interior card), e.g. none while lit, lowered or hidden. */
  set(i: number, glass: boolean, card: boolean): void {
    const s = this.slots[i];
    if (!s || (s.glass === glass && s.card === card)) return;
    s.glass = glass;
    s.card = card;
    this.write(i);
  }

  /** Player tile (sim x / y): cards within NEAR_TILES hide so the real room shows. */
  setNear(px: number | undefined, py: number | undefined): void {
    const key = px === undefined || py === undefined ? '-' : `${Math.floor(px)},${Math.floor(py)}`;
    if (key === this.nearKey) return;
    this.nearKey = key;
    this.near = px === undefined || py === undefined ? undefined : { px, py };
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const near =
        px !== undefined &&
        py !== undefined &&
        Math.abs(s.x - px) < NEAR_TILES &&
        Math.abs(s.y - py) < NEAR_TILES;
      if (near === s.near) continue;
      s.near = near;
      this.write(i);
    }
  }

  /** Card currently drawn at slot `i` (tests). */
  cardShown(i: number): boolean {
    const s = this.slots[i];
    return !!s && s.live && s.card && !s.near;
  }

  glassShown(i: number): boolean {
    const s = this.slots[i];
    return !!s && s.live && s.glass;
  }

  private write(i: number): void {
    const s = this.slots[i]!;
    this.glass.setMatrixAt(i, s.live && s.glass ? this.glassM[i]! : ZERO);
    this.card.setMatrixAt(i, s.live && s.card && !s.near ? this.cardM[i]! : ZERO);
    this.glass.instanceMatrix.needsUpdate = true;
    this.card.instanceMatrix.needsUpdate = true;
    const a = this.card.geometry.getAttribute('aCell');
    a.needsUpdate = true;
  }

  dispose(): void {
    this.glass.geometry.dispose();
    this.card.geometry.dispose();
    (this.glass.material as MeshStandardMaterial).dispose();
    (this.card.material as MeshLambertMaterial).dispose();
    this.glass.dispose();
    this.card.dispose();
    this.root.clear();
  }
}
