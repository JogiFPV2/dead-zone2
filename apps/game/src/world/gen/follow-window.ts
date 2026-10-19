import { CHUNK_SIZE } from '../chunk.js';
import { genStartRange } from './maps.js';

type Bounds = { cx0: number; cy0: number; cx1: number; cy1: number };
export type WindowRange = Bounds & { z: number };

/**
 * Chunk window that follows the player on a generated map (minimap, beds / sofas, shelves,
 * paper map read the streamed chunks inside it): there is no fixed window around the start, so
 * the whole map works. `update` reports a change when the player's chunk is `step` chunks off
 * the window centre or the streamer loaded / dropped chunks since the last rebuild (checked at
 * most every `everyMs`).
 */
export class FollowWindow {
  range: WindowRange;
  private cx: number;
  private cy: number;
  private loaded = -1;
  private last = -Infinity;

  constructor(
    private readonly bounds: Bounds,
    start: { x: number; y: number },
    readonly radius: number,
    private readonly step = 2,
    private readonly everyMs = 1500,
  ) {
    this.range = genStartRange(bounds, start, radius);
    this.cx = Math.floor(start.x / CHUNK_SIZE);
    this.cy = Math.floor(start.y / CHUNK_SIZE);
  }

  /** New window when due; true when `range` changed or its chunks did. */
  update(p: { x: number; y: number }, loadedChunks: number, now: number): boolean {
    if (now - this.last < this.everyMs) return false;
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cy = Math.floor(p.y / CHUNK_SIZE);
    const moved = Math.max(Math.abs(cx - this.cx), Math.abs(cy - this.cy)) >= this.step;
    if (!moved && loadedChunks === this.loaded) return false;
    this.last = now;
    this.loaded = loadedChunks;
    if (moved) {
      this.cx = cx;
      this.cy = cy;
    }
    this.range = genStartRange(this.bounds, { x: p.x, y: p.y }, this.radius);
    return true;
  }
}
