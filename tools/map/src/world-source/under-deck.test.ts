import { expect, it } from 'vitest';
import { clearUnderDeck } from './under-deck.js';
import { G_DIRT, G_GRASS, G_PARKING } from './palette.js';

it('pod pokładem wiaduktu przy torach nie ma asfaltu (Designer 27.10)', () => {
  const w = 30;
  const rail = new Uint8Array(w);
  rail[0] = 1;
  const deck = new Uint8Array(w).fill(1);
  const under = new Uint8Array(w).fill(G_PARKING + 1);
  under[3] = G_GRASS + 1;
  clearUnderDeck(w, 1, rail, deck, under, 10);
  expect(under[5]).toBe(G_DIRT + 1);
  expect(under[3]).toBe(G_GRASS + 1);
  expect(under[20]).toBe(G_PARKING + 1);
});
