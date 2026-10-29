import { G_ASPHALT, G_PARKING, G_SIDEWALK } from './palette.js';

/** Raster planes the railing rule reads (`rasterGround`). */
export interface DeckPlanes {
  g: Uint8Array;
  deck: Uint8Array;
}

/**
 * Railing between raster cells a and b: on a bridge deck's side edge, wherever the deck meets
 * anything but the road it carries on (asphalt, sidewalk, parking at the bridge ends). Runs along
 * the whole deck on both sides, also between two separate OSM bridges of a dual carriageway.
 */
export function deckRailingEdge(r: DeckPlanes, a: number, b: number): boolean {
  if (!!r.deck[a] === !!r.deck[b]) return false;
  const off = r.deck[a] ? b : a;
  const g = r.g[off];
  return g !== G_ASPHALT && g !== G_SIDEWALK && g !== G_PARKING;
}
