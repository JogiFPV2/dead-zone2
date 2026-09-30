/**
 * Promise cache keyed by URL with reference counting: concurrent loads share one request, the
 * value is disposed when the last user releases it, failed loads are not cached.
 */
export class RefCache<T> {
  private readonly entries = new Map<string, { value: Promise<T>; refs: number }>();

  constructor(private readonly disposeValue: (value: T, key: string) => void = () => {}) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  refs(key: string): number {
    return this.entries.get(key)?.refs ?? 0;
  }

  /** Returns the cached value (refs + 1) or starts `load`. */
  acquire(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit) {
      hit.refs++;
      return hit.value;
    }
    const value = load();
    this.entries.set(key, { value, refs: 1 });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  /** refs − 1; at zero the entry is removed and disposed. */
  release(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    if (--e.refs > 0) return;
    this.entries.delete(key);
    void e.value.then((v) => this.disposeValue(v, key)).catch(() => {});
  }

  /** Disposes everything regardless of refs. */
  clear(): void {
    const all = [...this.entries];
    this.entries.clear();
    for (const [key, e] of all) void e.value.then((v) => this.disposeValue(v, key)).catch(() => {});
  }
}
