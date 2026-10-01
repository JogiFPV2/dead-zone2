import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  type Object3D,
} from 'three';
import type { GroundPileView, NearbyContainerView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';

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
}

/**
 * PLACEHOLDER ground item piles (`view.groundPiles`, within 24 tiles): a light grey box and a
 * floating accent marker, bigger when the pile is in reach (F opens it).
 */
export class GroundPiles {
  readonly root = new Group();
  private readonly piles = new Map<number, Pile>();
  private last: readonly GroundPileView[] | undefined;
  private near = new Set<number>();
  /** Model for new piles (cardboard box); undefined = grey box. */
  pileModel: (() => Object3D) | undefined;

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
          const model = this.pileModel?.();
          const box = model ?? new Mesh(BOX, BOX_MATERIAL);
          box.castShadow = true;
          box.receiveShadow = true;
          if (!model) box.position.y = 0.15;
          const marker = new Mesh(MARKER_GEOMETRY, MARKER_MATERIAL);
          root.add(box, marker);
          p = { root, marker, baseY: MARKER_Y };
          this.piles.set(c.id, p);
          this.root.add(root);
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
}
