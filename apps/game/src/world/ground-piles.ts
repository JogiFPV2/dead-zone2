import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Object3D,
  type Texture,
} from 'three';
import type { GroundPileView, NearbyContainerView } from '@deadzone/protocol';
import { itemImage } from '../hud/item-icons.js';
import { simToWorld } from '../sim/coords.js';

/** Item lying on the ground: its icon on a flat quad (icons are baked from the 3D models). */
const ITEM_SIZE = 0.42;
const ITEM_QUAD = new PlaneGeometry(ITEM_SIZE, ITEM_SIZE).rotateX(-Math.PI / 2);
/** Item without an icon: a small grey box. */
const ITEM_BOX = new BoxGeometry(0.22, 0.1, 0.16);

/**
 * Deterministic spot of item `k` of pile `id` on its tile: the first in the middle, the rest
 * around it (no two at the same place), turned at random. Returns [dx, dz, yaw] in metres / rad.
 */
export function itemSpot(id: number, k: number): [number, number, number] {
  const h = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
  const r = h - Math.floor(h);
  if (k === 0) return [0, 0, r * Math.PI * 2];
  const ang = (k - 1) * ((Math.PI * 2) / 3) + id * 0.7;
  return [Math.cos(ang) * 0.24, Math.sin(ang) * 0.24, r * Math.PI * 2];
}

const BOX = new BoxGeometry(0.55, 0.3, 0.55);
const BOX_MATERIAL = new MeshStandardMaterial({ color: 0xa4a9ad, roughness: 0.85 });
/** Floating marker above loot (accent, self-lit so it reads at night too). */
export const MARKER_GEOMETRY = new OctahedronGeometry(0.16);
export const MARKER_MATERIAL = new MeshStandardMaterial({
  color: 0xe0a23a,
  emissive: 0xe0a23a,
  emissiveIntensity: 0.9,
  roughness: 0.5,
});
const MARKER_Y = 1.15;

/** Bobbing + spin for loot markers; `near` markers are bigger. */
export function animateMarker(m: Object3D, baseY: number, near: boolean, nowMs: number): void {
  m.position.y = baseY + Math.sin(nowMs / 400) * 0.08;
  m.rotation.y = nowMs / 700;
  m.scale.setScalar(near ? 1.5 : 1);
}

interface Pile {
  root: Group;
  marker: Mesh;
  baseY: number;
  /** Item defs drawn (joined), to rebuild only on change. */
  key: string;
  body: Group;
}

/**
 * Ground item piles (`view.groundPiles`, within 24 tiles): the top items (`items`, up to
 * GROUND_PILE_SHOWN) lie on the floor as their icons; a pile without the list (older sim) is
 * a box. A floating accent marker shows it, bigger when the pile is in reach (F opens it).
 */
export class GroundPiles {
  readonly root = new Group();
  private readonly piles = new Map<number, Pile>();
  private last: readonly GroundPileView[] | undefined;
  private near = new Set<number>();
  /** Model for piles without an item list (cardboard box); undefined = grey box. */
  pileModel: (() => Object3D) | undefined;
  /** Icon texture by URL (default: TextureLoader, cached); undefined = no icon. */
  iconTexture: (url: string) => Texture | undefined = (url) => this.loadIcon(url);
  private readonly textures = new Map<string, Texture>();
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly boxMaterial = new MeshStandardMaterial({ color: 0x8b8f93, roughness: 0.8 });

  update(
    piles: readonly GroundPileView[],
    nearby: readonly NearbyContainerView[],
    nowMs: number,
  ): void {
    if (piles !== this.last) {
      this.last = piles;
      const seen = new Set<number>();
      for (const c of piles) {
        seen.add(c.id);
        let p = this.piles.get(c.id);
        if (!p) {
          const root = new Group();
          const body = new Group();
          const marker = new Mesh(MARKER_GEOMETRY, MARKER_MATERIAL);
          root.add(body, marker);
          p = { root, marker, baseY: MARKER_Y, key: '\u0000', body };
          this.piles.set(c.id, p);
          this.root.add(root);
        }
        const pile = p;
        const key = c.items === undefined ? '\u0001' : c.items.join(',');
        if (key !== pile.key) {
          pile.key = key;
          pile.body.clear();
          if (c.items === undefined || c.items.length === 0) pile.body.add(this.boxModel());
          else c.items.forEach((def, k) => pile.body.add(this.itemModel(c.id, k, def)));
        }
        const w = simToWorld(c.x + 0.5, c.y + 0.5, c.z);
        p.root.position.set(w.x, w.y, w.z);
      }
      for (const [id, p] of this.piles) {
        if (seen.has(id)) continue;
        this.root.remove(p.root);
        this.piles.delete(id);
      }
    }
    this.near = new Set(nearby.filter((n) => n.kind === 'ground').map((n) => n.id));
    for (const [id, p] of this.piles) animateMarker(p.marker, p.baseY, this.near.has(id), nowMs);
  }

  /** Meshes lying on the ground per pile (tests). */
  itemsOf(id: number): Object3D[] {
    return [...(this.piles.get(id)?.body.children ?? [])];
  }

  private boxModel(): Object3D {
    const model = this.pileModel?.();
    const box = model ?? new Mesh(BOX, BOX_MATERIAL);
    box.castShadow = true;
    box.receiveShadow = true;
    if (!model) box.position.y = 0.15;
    return box;
  }

  private itemModel(id: number, k: number, def: string): Object3D {
    const [dx, dz, yaw] = itemSpot(id, k);
    const url = itemImage(def);
    const tex = url ? this.iconTexture(url) : undefined;
    let m: Mesh;
    if (tex) {
      let mat = this.materials.get(url!);
      if (!mat) {
        mat = new MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.85 });
        this.materials.set(url!, mat);
      }
      m = new Mesh(ITEM_QUAD, mat);
      // Stacked a few mm apart so overlapping icons don't flicker.
      m.position.set(dx, 0.02 + k * 0.004, dz);
    } else {
      m = new Mesh(ITEM_BOX, this.boxMaterial);
      m.castShadow = true;
      m.position.set(dx, 0.05, dz);
    }
    m.rotation.y = yaw;
    m.receiveShadow = true;
    m.name = def;
    return m;
  }

  private loadIcon(url: string): Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = new TextureLoader().load(url);
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      this.textures.set(url, t);
    }
    return t;
  }
}
