import { Vector3, type Camera } from 'three';
import { SnapshotAnim } from '@deadzone/protocol';
import { CROWD_SAMPLE_STRIDE, type CrowdBuffer } from '../crowd/crowd-buffer.js';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import { LEVEL_HEIGHT } from '../world/instances.js';
import { HP_SEGMENTS, hpBand, hpSegments, hpView, pickNearest } from './zombie-hp-model.js';
import './zombie-hp.css';

/** World height of the overlay anchor above a zombie's feet (head + room for the !/? marker). */
const ANCHOR_Y = PLAYER_HEIGHT + 0.12;
/** Shift + LMB picks a zombie within this distance (tiles) of the floor point under the cursor. */
export const PICK_RADIUS = 0.9;
/** Height (world units) of the plane the Shift + LMB ray is intersected with: the zombie's waist. */
export const PICK_PLANE_Y = PLAYER_HEIGHT * 0.55;

export interface ZombieHpOptions {
  /** „Pokazuj życie zombie”: small bar over every wounded zombie. */
  showWounded: boolean;
  /** Target bubble (Shift + LMB) enabled. */
  targeting: boolean;
}

/**
 * Zombie health over the world (approved mockup, HUD A): a 48×6 bar over wounded zombies
 * (setting, default off) and a „Zombie” bubble with a segmented bar over the targeted one.
 * DOM elements are pooled; positions are `Vector3.project` → `translate3d` every frame.
 */
export class ZombieHpLayer {
  readonly root = document.createElement('div');
  private readonly bars: { el: HTMLDivElement; fill: HTMLElement }[] = [];
  private readonly bubble: HTMLDivElement;
  private readonly segs: HTMLElement[] = [];
  private sampled = new Float32Array(0);
  private sampledCount = 0;
  private targetId: number | undefined;
  private readonly v = new Vector3();

  constructor(
    parent: HTMLElement,
    private readonly buffer: CrowdBuffer,
  ) {
    this.root.className = 'dz-zhp-layer';
    this.bubble = document.createElement('div');
    this.bubble.className = 'dz-zhp dz-zhp--target';
    const label = document.createElement('div');
    label.className = 'dz-zhp__label';
    label.textContent = 'Zombie';
    const track = document.createElement('div');
    track.className = 'dz-zhp__segs';
    for (let i = 0; i < HP_SEGMENTS; i++) {
      const s = document.createElement('i');
      track.append(s);
      this.segs.push(s);
    }
    this.bubble.append(label, track);
    this.bubble.hidden = true;
    this.root.append(this.bubble);
    parent.append(this.root);
  }

  /** Stable id of the targeted zombie (undefined: none). */
  get target(): number | undefined {
    return this.targetId;
  }

  /** Shows the bubble over this zombie (sim lock); undefined clears it. */
  setTarget(id: number | undefined): void {
    this.targetId = id;
  }

  /**
   * Live zombies on `level` within `maxDist` tiles of (x, z), nearest first (stable ids; last
   * sampled frame). Tab cycles through these.
   */
  nearby(x: number, z: number, level: number, maxDist: number): number[] {
    const b = this.buffer;
    const out: { id: number; d: number }[] = [];
    for (let i = 0; i < this.sampledCount; i++) {
      if (b.anim[i] === SnapshotAnim.dead || (b.hp[i] ?? 1) <= 0) continue;
      const s = i * CROWD_SAMPLE_STRIDE;
      if (Math.round(this.sampled[s + 2] ?? 0) !== Math.round(level)) continue;
      const d = Math.hypot((this.sampled[s] ?? 0) - x, (this.sampled[s + 1] ?? 0) - z);
      if (d <= maxDist) out.push({ id: b.slots.idAt(i), d });
    }
    return out.sort((a, b2) => a.d - b2.d || a.id - b2.id).map((o) => o.id);
  }

  /** Targets the zombie nearest to the floor point (world x/z), or clears the target. */
  pickAt(x: number, z: number): number | undefined {
    const b = this.buffer;
    const i = pickNearest(
      this.sampled,
      this.sampledCount,
      CROWD_SAMPLE_STRIDE,
      x,
      z,
      PICK_RADIUS,
      (k) => b.anim[k] === SnapshotAnim.dead || (b.hp[k] ?? 1) <= 0,
    );
    this.targetId = i < 0 ? undefined : b.slots.idAt(i);
    return this.targetId;
  }

  /** Live zombie within PICK_RADIUS of floor point (x, z) (last sampled frame), without targeting it. */
  zombieAt(x: number, z: number): boolean {
    const b = this.buffer;
    return (
      pickNearest(
        this.sampled,
        this.sampledCount,
        CROWD_SAMPLE_STRIDE,
        x,
        z,
        PICK_RADIUS,
        (k) => b.anim[k] === SnapshotAnim.dead || (b.hp[k] ?? 1) <= 0,
      ) >= 0
    );
  }

  update(
    alpha: number,
    camera: Camera,
    width: number,
    height: number,
    opts: ZombieHpOptions,
  ): void {
    const b = this.buffer;
    if (this.sampled.length < b.capacity * CROWD_SAMPLE_STRIDE) {
      this.sampled = new Float32Array(b.capacity * CROWD_SAMPLE_STRIDE);
    }
    const n = b.sample(alpha, this.sampled);
    this.sampledCount = n;
    let used = 0;
    let targetSeen = false;
    for (let i = 0; i < n; i++) {
      const id = b.slots.idAt(i);
      const hp = b.hp[i] ?? 1;
      const targeted = id === this.targetId;
      const dead = b.anim[i] === SnapshotAnim.dead;
      if (targeted && !dead && hp > 0) targetSeen = true;
      const view = hpView(hp, dead, targeted, opts);
      if (view === 'none') continue;
      const s = i * CROWD_SAMPLE_STRIDE;
      this.v
        .set(
          this.sampled[s] ?? 0,
          (this.sampled[s + 2] ?? 0) * LEVEL_HEIGHT + ANCHOR_Y,
          this.sampled[s + 1] ?? 0,
        )
        .project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) continue;
      const x = ((this.v.x + 1) / 2) * width;
      const y = ((1 - this.v.y) / 2) * height;
      const band = hpBand(hp);
      if (view === 'target') {
        this.place(this.bubble, x, y, band);
        const lit = hpSegments(hp);
        this.segs.forEach((seg, k) => seg.classList.toggle('on', k < lit));
        continue;
      }
      const bar = this.bars[used] ?? this.addBar();
      used++;
      this.place(bar.el, x, y, band);
      bar.fill.style.width = `${Math.round(hp * 100)}%`;
    }
    if (!targetSeen) this.targetId = undefined;
    this.bubble.hidden = !targetSeen || !opts.targeting;
    for (let k = used; k < this.bars.length; k++) this.bars[k]!.el.hidden = true;
  }

  private place(el: HTMLDivElement, x: number, y: number, band: string): void {
    el.hidden = false;
    el.dataset.band = band;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  private addBar(): { el: HTMLDivElement; fill: HTMLElement } {
    const el = document.createElement('div');
    el.className = 'dz-zhp dz-zhp--bar';
    const fill = document.createElement('i');
    el.append(fill);
    this.root.append(el);
    const bar = { el, fill };
    this.bars.push(bar);
    return bar;
  }
}
