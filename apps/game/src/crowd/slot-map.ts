/**
 * Dense stableId -> slot mapping. Slots 0..size-1 are always occupied; removal swaps the last
 * slot into the hole so instanced draws stay contiguous (InstancedMesh.count = size).
 */
export class SlotMap {
  private readonly slotOf = new Map<number, number>();
  private ids: Float64Array;
  private n = 0;

  constructor(
    initialCapacity = 256,
    readonly growBy = 256,
  ) {
    this.ids = new Float64Array(Math.max(1, initialCapacity));
  }

  get size(): number {
    return this.n;
  }

  get capacity(): number {
    return this.ids.length;
  }

  get(id: number): number | undefined {
    return this.slotOf.get(id);
  }

  idAt(slot: number): number {
    return this.ids[slot] ?? 0;
  }

  /** Adds `id` at the end; returns its slot. Grows capacity in `growBy` chunks. */
  add(id: number): number {
    const existing = this.slotOf.get(id);
    if (existing !== undefined) return existing;
    if (this.n === this.ids.length) {
      const next = new Float64Array(this.ids.length + this.growBy);
      next.set(this.ids);
      this.ids = next;
    }
    const slot = this.n++;
    this.ids[slot] = id;
    this.slotOf.set(id, slot);
    return slot;
  }

  /** Removes `id`; if another entity moved into its slot, `onMove(from, to)` is called first. */
  remove(id: number, onMove?: (from: number, to: number) => void): boolean {
    const slot = this.slotOf.get(id);
    if (slot === undefined) return false;
    const last = --this.n;
    if (slot !== last) {
      const movedId = this.ids[last] ?? 0;
      onMove?.(last, slot);
      this.ids[slot] = movedId;
      this.slotOf.set(movedId, slot);
    }
    this.slotOf.delete(id);
    return true;
  }
}
