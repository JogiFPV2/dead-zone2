import { SNAPSHOT_ENTITY_STRIDE, SnapshotField } from '@deadzone/protocol';
import { SlotMap } from './slot-map.js';

/** Floats per slot in prev/curr: x, y, z, facing. */
const S = 4;

/**
 * Last two snapshot states of every non-player entity, packed by slot. Snapshot pushes may
 * allocate (new entities, growth); `sample` never allocates, so it is safe per frame.
 */
export class CrowdBuffer {
  readonly slots: SlotMap;
  private prev: Float32Array;
  private curr: Float32Array;
  private seen: Uint32Array;
  /** SnapshotAnim of the latest snapshot per slot (4 = dead: corpse lies flat). */
  private animBySlot: Uint8Array;
  private generation = 0;

  constructor(initialCapacity = 256, growBy = 256) {
    this.slots = new SlotMap(initialCapacity, growBy);
    this.prev = new Float32Array(this.slots.capacity * S);
    this.curr = new Float32Array(this.slots.capacity * S);
    this.seen = new Uint32Array(this.slots.capacity);
    this.animBySlot = new Uint8Array(this.slots.capacity);
  }

  /** SnapshotAnim per slot (valid for 0..count-1). */
  get anim(): Uint8Array {
    return this.animBySlot;
  }

  get count(): number {
    return this.slots.size;
  }

  get capacity(): number {
    return this.slots.capacity;
  }

  /** Ingests a snapshot, skipping the first `skip` entities (the player). */
  push(buf: Float32Array, skip = 1): void {
    const gen = ++this.generation;
    const n = Math.floor(buf.length / SNAPSHOT_ENTITY_STRIDE);
    for (let e = skip; e < n; e++) {
      const o = e * SNAPSHOT_ENTITY_STRIDE;
      const id = buf[o + SnapshotField.stableId] ?? 0;
      const known = this.slots.get(id);
      const slot = known ?? this.slots.add(id);
      this.ensureCapacity();
      const p = slot * S;
      if (known === undefined) {
        // New entity: no history yet, so prev = curr (no lerp from the origin).
        this.write(this.curr, p, buf, o);
        this.prev.set(this.curr.subarray(p, p + S), p);
      } else {
        this.prev.set(this.curr.subarray(p, p + S), p);
        this.write(this.curr, p, buf, o);
      }
      this.seen[slot] = gen;
      this.animBySlot[slot] = buf[o + SnapshotField.anim] ?? 0;
    }
    // Drop entities missing from this snapshot (iterate backwards: swap-remove moves the tail).
    for (let slot = this.slots.size - 1; slot >= 0; slot--) {
      if (this.seen[slot] !== gen) this.slots.remove(this.slots.idAt(slot), this.move);
    }
  }

  /**
   * Interpolated x, y, z, facing per slot into `out` (length >= count * 4). Facing takes the
   * shortest arc. Returns the number of entities written.
   */
  sample(alpha: number, out: Float32Array): number {
    const { prev, curr } = this;
    const n = this.slots.size;
    for (let i = 0; i < n * S; i += S) {
      out[i] = lerp(prev[i] ?? 0, curr[i] ?? 0, alpha);
      out[i + 1] = lerp(prev[i + 1] ?? 0, curr[i + 1] ?? 0, alpha);
      out[i + 2] = lerp(prev[i + 2] ?? 0, curr[i + 2] ?? 0, alpha);
      const a = prev[i + 3] ?? 0;
      const b = curr[i + 3] ?? 0;
      out[i + 3] = a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * alpha;
    }
    return n;
  }

  private readonly move = (from: number, to: number): void => {
    this.prev.copyWithin(to * S, from * S, from * S + S);
    this.curr.copyWithin(to * S, from * S, from * S + S);
    this.seen[to] = this.seen[from] ?? 0;
    this.animBySlot[to] = this.animBySlot[from] ?? 0;
  };

  private write(dst: Float32Array, p: number, buf: Float32Array, o: number): void {
    dst[p] = buf[o + SnapshotField.x] ?? 0;
    dst[p + 1] = buf[o + SnapshotField.y] ?? 0;
    dst[p + 2] = buf[o + SnapshotField.z] ?? 0;
    dst[p + 3] = buf[o + SnapshotField.facingRad] ?? 0;
  }

  private ensureCapacity(): void {
    const cap = this.slots.capacity;
    if (this.seen.length >= cap) return;
    this.prev = grow(this.prev, cap * S);
    this.curr = grow(this.curr, cap * S);
    const seen = new Uint32Array(cap);
    seen.set(this.seen);
    this.seen = seen;
    const anim = new Uint8Array(cap);
    anim.set(this.animBySlot);
    this.animBySlot = anim;
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function grow(a: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length);
  next.set(a);
  return next;
}

/** Floats per entity written by CrowdBuffer.sample. */
export const CROWD_SAMPLE_STRIDE = S;
