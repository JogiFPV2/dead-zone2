/**
 * Spatial hash over entity positions (docs 2.2: cells of 4×4 tiles). Rebuilt once per tick from
 * a StableId-sorted list, so every query returns entities in a deterministic order (cell by
 * cell, StableId order inside a cell). Derived state: never hashed or saved.
 */
export const SPATIAL_CELL_TILES = 4;

const cellKey = (cx: number, cy: number): number => (cx + 0x8000) * 0x10000 + (cy + 0x8000);

export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly used: number[][] = [];

  clear(): void {
    for (const a of this.used) a.length = 0;
    this.used.length = 0;
  }

  insert(eid: number, x: number, y: number): void {
    const key = cellKey(Math.floor(x / SPATIAL_CELL_TILES), Math.floor(y / SPATIAL_CELL_TILES));
    let a = this.cells.get(key);
    if (!a) {
      a = [];
      this.cells.set(key, a);
    }
    if (a.length === 0) this.used.push(a);
    a.push(eid);
  }

  /**
   * Calls `fn` for every entity in cells overlapping the square [x − r, x + r] × [y − r, y + r]
   * (callers filter by exact distance). Rows top to bottom, cells left to right.
   */
  query(x: number, y: number, r: number, fn: (eid: number) => void): void {
    const cx0 = Math.floor((x - r) / SPATIAL_CELL_TILES);
    const cx1 = Math.floor((x + r) / SPATIAL_CELL_TILES);
    const cy0 = Math.floor((y - r) / SPATIAL_CELL_TILES);
    const cy1 = Math.floor((y + r) / SPATIAL_CELL_TILES);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const a = this.cells.get(cellKey(cx, cy));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) fn(a[i]!);
      }
    }
  }
}
