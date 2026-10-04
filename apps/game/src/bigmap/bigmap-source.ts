import type { FogGrid, Marker, MarkerDraft } from './bigmap-model.js';

/**
 * Where the big map gets its data: the sim's player map (`SimBigMapSource`: discovery bitmap,
 * trail, markers and the addMarker / editMarker / removeMarker commands).
 */
export interface BigMapSource {
  /** Discovery bitmap over the sim's chunk bounds. */
  fog(): FogGrid;
  /** Bumps whenever `fog()` changes (cheap redraw check). */
  readonly fogVersion: number;
  /** x0, y0, x1, y1, … (metres), oldest first. */
  trail(): Float32Array;
  readonly trailVersion: number;
  markers(): readonly Marker[];
  addMarker(m: MarkerDraft): void;
  editMarker(id: number, m: MarkerDraft): void;
  removeMarker(id: number): void;
}
