import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { ContainerId, StorageMarkerView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';
import type { ChunkRange, ChunkSource } from './chunk.js';
import { CHUNK_SIZE } from './chunk.js';
import {
  PROP_KINDS,
  SHELF_PROFILES,
  displayFill,
  hashId,
  propSlots,
  shelfOrigin,
  slotCount,
  visibleProps,
  type PropKind,
  type PropSlot,
  type ShelfProfile,
} from './shelf-fill-model.js';
import { FOOTPRINTS_OFF, type FurnitureFootprints } from './furniture-footprint.js';

/** Generic prop meshes (geometry base at y = 0) and their colour sets. */
const PROP_GEOMETRY: Record<PropKind, () => BufferGeometry> = {
  can: () => new CylinderGeometry(0.035, 0.035, 0.1, 10).translate(0, 0.05, 0),
  box: () => new BoxGeometry(0.1, 0.15, 0.07).translate(0, 0.075, 0),
  bottle: () => new CylinderGeometry(0.025, 0.03, 0.2, 8).translate(0, 0.1, 0),
  jar: () => new CylinderGeometry(0.035, 0.035, 0.08, 10).translate(0, 0.04, 0),
  carton: () => new BoxGeometry(0.06, 0.18, 0.06).translate(0, 0.09, 0),
  books: () => new BoxGeometry(0.11, 0.2, 0.15).translate(0, 0.1, 0),
};
const PROP_COLORS: Record<PropKind, readonly number[]> = {
  can: [0xb8b4a8, 0xa83a2c, 0x3f6e8c, 0xc9a23c],
  box: [0xb08a5a, 0xc2493a, 0x5d7f4a, 0xd6c79a],
  bottle: [0x4d8a5a, 0x6aa0c8, 0x8c5a3a],
  jar: [0xc98a3a, 0xa04a3a, 0xd8c070],
  carton: [0xe8e4da, 0x6aa0c8, 0xd8b440],
  books: [0x7a2e2e, 0x2e4a7a, 0x3e6a3e, 0x8a6a2e, 0x5a3a6a],
};

interface Furniture {
  readonly key: string;
  readonly tx: number;
  readonly ty: number;
  readonly z: number;
  /** Rotation 0–3 (content `objects[].rot`). */
  readonly rot: number;
  readonly contentId: string;
  readonly profile: ShelfProfile;
  /** Slot layout centre: anchor tile centre, or the footprint centre with footprints on. */
  readonly origin: Vector3;
  readonly yaw: number;
  /** Seeded slots (by container id once the sim reports it). */
  slots?: PropSlot[];
  seededFor?: ContainerId;
}

/**
 * Props on furniture shelves showing how full each storage is (deadzone-loot-spec §3).
 * One InstancedMesh per prop kind for the whole map (6 draw calls, no shadow casting) instead of
 * per furniture, to stay inside the 250 draw-call budget. Closed furniture only shows its
 * contents while its loot panel is open (the furniture model is see-through then, `onXray`).
 */
export class ShelfFill {
  readonly root = new Group();
  private readonly furniture: Furniture[] = [];
  private readonly byTile = new Map<string, Furniture>();
  private readonly meshes = new Map<PropKind, InstancedMesh>();
  private lastStorages: readonly StorageMarkerView[] | undefined;
  private lastActive: ContainerId | undefined;
  private xray: Furniture | undefined;
  /** Furniture footprints (`worldSettings.furniture.footprint`); off = one tile each, as before. */
  private footprints: FurnitureFootprints = FOOTPRINTS_OFF;
  /** Props shown last update (debug / tests). */
  shown = 0;

  constructor(
    source: ChunkSource,
    range: ChunkRange,
    private readonly onXray?: (tx: number, ty: number, z: number, on: boolean) => void,
  ) {
    const capacity = new Map<PropKind, number>(PROP_KINDS.map((k) => [k, 0]));
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const z = range.z;
        for (const o of source.getChunk(cx, cy, z)?.objects ?? []) {
          const profile = SHELF_PROFILES[o.contentId];
          if (!profile) continue;
          const tx = cx * CHUNK_SIZE + o.x;
          const ty = cy * CHUNK_SIZE + o.y;
          const f: Furniture = {
            key: `${tx},${ty},${z}`,
            tx,
            ty,
            z,
            rot: o.rot,
            contentId: o.contentId,
            profile,
            origin: new Vector3(),
            yaw: (-o.rot * Math.PI) / 2,
          };
          this.placeOrigin(f);
          this.furniture.push(f);
          this.byTile.set(f.key, f);
          // Any kind of the mix may take every slot.
          for (const k of PROP_KINDS) {
            if ((profile.mix[k] ?? 0) > 0) capacity.set(k, capacity.get(k)! + slotCount(profile));
          }
        }
      }
    }
    for (const kind of PROP_KINDS) {
      const n = capacity.get(kind)!;
      if (n === 0) continue;
      const mesh = new InstancedMesh(
        PROP_GEOMETRY[kind](),
        new MeshStandardMaterial({ roughness: 0.7 }),
        n,
      );
      mesh.count = 0;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `shelf-${kind}`;
      this.meshes.set(kind, mesh);
      this.root.add(mesh);
    }
  }

  /** Slot layout centre of `f` for the current footprints (`shelfOrigin`). */
  private placeOrigin(f: Furniture): void {
    const fp = this.footprints.enabled ? this.footprints.of(f.contentId) : undefined;
    const c = shelfOrigin(f.tx, f.ty, f.rot, fp);
    const p = simToWorld(c.x, c.y, f.z);
    f.origin.set(p.x, p.y, p.z);
  }

  /**
   * Switches furniture footprints (same flag as `MapObjects.setFootprints`): with them on the
   * props are laid out around the footprint centre, off around the anchor tile centre (as before).
   * The next `update` re-lays every prop.
   */
  setFootprints(f: FurnitureFootprints): void {
    if (f === this.footprints) return;
    this.footprints = f;
    for (const fu of this.furniture) this.placeOrigin(fu);
    this.lastStorages = undefined;
  }

  /** Re-lays the props when the storage list or the open container changes. */
  update(storages: readonly StorageMarkerView[], active: ContainerId | undefined): void {
    if (storages === this.lastStorages && active === this.lastActive) return;
    this.lastStorages = storages;
    this.lastActive = active;
    const counts = new Map<PropKind, number>();
    for (const k of this.meshes.keys()) counts.set(k, 0);
    let xray: Furniture | undefined;
    this.shown = 0;
    for (const s of storages) {
      const f = this.byTile.get(`${s.x},${s.y},${s.z}`);
      if (!f) continue;
      const isActive = s.id === active;
      if (isActive && !f.profile.open) xray = f;
      if (!f.profile.open && !isActive) continue;
      if (!f.slots || f.seededFor !== s.id) {
        f.slots = propSlots(f.profile, hashId(s.id));
        f.seededFor = s.id;
      }
      const n = visibleProps(displayFill(s.fillPct, s.searched, s.id), f.slots.length);
      for (let i = 0; i < n; i++) this.place(f, f.slots[i]!, counts, i);
      this.shown += n;
    }
    for (const [k, mesh] of this.meshes) {
      mesh.count = counts.get(k)!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (xray !== this.xray) {
      if (this.xray) this.onXray?.(this.xray.tx, this.xray.ty, this.xray.z, false);
      if (xray) this.onXray?.(xray.tx, xray.ty, xray.z, true);
      this.xray = xray;
    }
  }

  private place(f: Furniture, slot: PropSlot, counts: Map<PropKind, number>, i: number): void {
    const mesh = this.meshes.get(slot.kind);
    if (!mesh) return;
    const at = counts.get(slot.kind)!;
    if (at >= mesh.instanceMatrix.count) return;
    const cos = Math.cos(f.yaw);
    const sin = Math.sin(f.yaw);
    pos.set(
      f.origin.x + slot.x * cos + slot.z * sin,
      f.origin.y + slot.y,
      f.origin.z - slot.x * sin + slot.z * cos,
    );
    quat.setFromAxisAngle(UP, f.yaw + slot.rot);
    m4.compose(pos, quat, scale.setScalar(f.profile.propScale ?? 1));
    mesh.setMatrixAt(at, m4);
    const colors = PROP_COLORS[slot.kind];
    mesh.setColorAt(at, color.setHex(colors[(i + (f.seededFor ?? 0)) % colors.length]!));
    counts.set(slot.kind, at + 1);
  }
}

const UP = new Vector3(0, 1, 0);
const scale = new Vector3(1, 1, 1);
const pos = new Vector3();
const quat = new Quaternion();
const m4 = new Matrix4();
const color = new Color();
