import type { LitWindowView } from '@deadzone/protocol';

/** Window edge key: `tx,ty,z,N|W` (edge owned by the tile, like `OpeningView`). */
export type WindowKey = string;

export const windowKey = (tx: number, ty: number, z: number, axis: 'N' | 'W'): WindowKey =>
  `${tx},${ty},${z},${axis}`;

/** Night for room lights seen through windows (same hours as the decorative lit windows). */
export const isLightNight = (minute: number): boolean => minute >= 19 * 60 || minute < 6 * 60;

/**
 * Window keys from the sim's `view.litWindows` (protocol 34: windows of rooms with a switched-on
 * lamp, curtains open, not boarded; any time of day). `x`/`y` is the edge midpoint: a north edge
 * sits on a whole `y` (x = tx + 0.5), a west edge on a whole `x` (y = ty + 0.5).
 */
export function litWindowKeys(list: readonly LitWindowView[]): Set<WindowKey> {
  const out = new Set<WindowKey>();
  for (const w of list) {
    const north = Number.isInteger(w.y) && !Number.isInteger(w.x);
    out.add(
      north ? windowKey(Math.floor(w.x), w.y, w.z, 'N') : windowKey(w.x, Math.floor(w.y), w.z, 'W'),
    );
  }
  return out;
}

/** Keys of one level without the floor (`tx,ty,axis`, the `TownStructures` window index). */
export function levelWindowKeys(keys: ReadonlySet<WindowKey>, z: number): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    const [tx, ty, kz, axis] = k.split(',');
    if (Number(kz) === z) out.add(`${tx},${ty},${axis}`);
  }
  return out;
}
