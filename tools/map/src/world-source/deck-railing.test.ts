import { expect, it } from 'vitest';
import { deckRailingEdge } from './deck-railing.js';
import { G_ASPHALT, G_GRASS, G_RAIL, G_SIDEWALK } from './palette.js';

it('barierki wiaduktu biegną wzdłuż krawędzi pokładu, nie w poprzek jezdni (Designer 27.10)', () => {
  // Cells: 0 deck (asphalt), 1 rail under the side, 2 grass median, 3 road beyond the bridge end,
  // 4 sidewalk beyond the end, 5 another deck cell.
  const r = {
    g: Uint8Array.from([G_ASPHALT, G_RAIL, G_GRASS, G_ASPHALT, G_SIDEWALK, G_ASPHALT]),
    deck: Uint8Array.from([1, 0, 0, 0, 0, 1]),
  };
  expect(deckRailingEdge(r, 0, 1)).toBe(true);
  expect(deckRailingEdge(r, 2, 0)).toBe(true);
  expect(deckRailingEdge(r, 0, 3)).toBe(false);
  expect(deckRailingEdge(r, 4, 0)).toBe(false);
  expect(deckRailingEdge(r, 0, 5)).toBe(false);
});
