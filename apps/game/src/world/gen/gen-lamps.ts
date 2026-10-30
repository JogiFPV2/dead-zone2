import type { LampDef } from '../../lighting/street-lamps.js';
import type { ChunkRange } from '../chunk.js';
import { hash01 } from '../town/modules.js';
import type { WorldChunk } from '../streaming/source.js';

/** Loaded generator columns by chunk (the streamer's `loaded`). */
export interface ColumnLookup {
  column(cx: number, cy: number): WorldChunk | undefined;
}

/**
 * Street lamps of the generated map in `range` (the generator's `lamps`: OSM `street_lamp`
 * nodes and evenly spaced lamps along carriageways). World metres → floor (x, z); ~1 in 10 broken.
 */
export function genLampsOf(loaded: ColumnLookup, range: ChunkRange): LampDef[] {
  const out: LampDef[] = [];
  for (let cy = range.cy0; cy <= range.cy1; cy++)
    for (let cx = range.cx0; cx <= range.cx1; cx++)
      for (const l of loaded.column(cx, cy)?.lamps ?? [])
        out.push({
          x: l.x,
          z: l.y,
          armX: l.ax,
          armZ: l.ay,
          working: hash01(Math.floor(l.x), Math.floor(l.y), 31) > 0.1,
        });
  return out;
}
