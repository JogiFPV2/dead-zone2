import { G_ASPHALT, G_CONCRETE, G_DIRT, G_PARKING, G_SIDEWALK } from './palette.js';

/** How far (m = raster cells) from a track paved ground under a deck turns into railway dirt. */
export const UNDER_DECK_RAIL_M = 10;

const PAVED = new Set([G_ASPHALT, G_SIDEWALK, G_PARKING, G_CONCRETE]);

/**
 * Railway corridor under a bridge deck (Designer 27.10: wide asphalt under the viaduct): paved
 * ground kept under deck cells (`under`, ground +1) within `UNDER_DECK_RAIL_M` of a track becomes
 * dirt, so no road or parking shows at the deck edges over the railway. Mutates `under`.
 */
export function clearUnderDeck(
  w: number,
  h: number,
  rail: Uint8Array,
  deck: Uint8Array,
  under: Uint8Array,
  m = UNDER_DECK_RAIL_M,
): void {
  const near = dilate(dilate(rail, w, h, m, true), w, h, m, false);
  for (let i = 0; i < w * h; i++) {
    const u = under[i]!;
    if (deck[i] && near[i] && u && PAVED.has(u - 1)) under[i] = G_DIRT + 1;
  }
}

/** Box dilation of a 0/1 mask by `m` cells along x (`dx`) or y. */
function dilate(src: Uint8Array, w: number, h: number, m: number, dx: boolean) {
  const out = new Uint8Array(w * h);
  const len = dx ? w : h;
  const lines = dx ? h : w;
  for (let l = 0; l < lines; l++) {
    let last = -Infinity;
    const at = (k: number) => (dx ? l * w + k : k * w + l);
    for (let k = 0; k < len; k++) {
      if (src[at(k)]) last = k;
      if (k - last <= m) out[at(k)] = 1;
    }
    last = Infinity;
    for (let k = len - 1; k >= 0; k--) {
      if (src[at(k)]) last = k;
      if (last - k <= m) out[at(k)] = 1;
    }
  }
  return out;
}
