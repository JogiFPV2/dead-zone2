import { Texture, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import type { GroundPileView } from '@deadzone/protocol';
import { setItemIcons } from '../hud/item-icons.js';
import { GroundPiles, itemSpot } from './ground-piles.js';

setItemIcons(
  new Map([
    ['base:canned-beans', '/icons/canned-beans.png'],
    ['base:kitchen-knife', '/icons/kitchen-knife.png'],
  ]),
);

function piles() {
  const g = new GroundPiles();
  const loaded: string[] = [];
  g.iconTexture = (url) => {
    loaded.push(url);
    return new Texture();
  };
  return { g, loaded };
}
const pile = (items?: string[]): GroundPileView => ({
  id: 7,
  x: 3,
  y: 4,
  z: 0,
  ...(items ? { items } : {}),
});

describe('GroundPiles', () => {
  it('lays the top items on the floor as icons (one texture per icon), unknown icons as boxes', () => {
    const { g, loaded } = piles();
    g.update(
      [pile(['base:canned-beans', 'base:kitchen-knife', 'base:canned-beans', 'base:odd'])],
      [],
      0,
    );
    const items = g.itemsOf(7);
    expect(items.map((m) => m.name)).toEqual([
      'base:canned-beans',
      'base:kitchen-knife',
      'base:canned-beans',
      'base:odd',
    ]);
    const mats = items.map((m) => (m as Mesh).material);
    expect(mats[0]).toBe(mats[2]); // same icon → same material
    expect(new Set(loaded)).toEqual(
      new Set(['/icons/canned-beans.png', '/icons/kitchen-knife.png']),
    );
    // Lying flat just above the floor, not all on one spot.
    for (const m of items) expect(m.position.y).toBeLessThan(0.1);
    const spots = new Set(
      items.map((m) => `${m.position.x.toFixed(2)},${m.position.z.toFixed(2)}`),
    );
    expect(spots.size).toBe(4);
  });

  it('rebuilds only when the item list changes; no list (older sim) or empty = a box', () => {
    const { g } = piles();
    g.update([pile(['base:canned-beans'])], [], 0);
    const first = g.itemsOf(7)[0];
    g.update([pile(['base:canned-beans'])], [], 16);
    expect(g.itemsOf(7)[0]).toBe(first);
    g.update([pile(['base:kitchen-knife'])], [], 32);
    expect(g.itemsOf(7)[0]?.name).toBe('base:kitchen-knife');
    g.update([pile()], [], 48);
    expect(g.itemsOf(7)).toHaveLength(1);
    expect(g.itemsOf(7)[0]?.name).toBe('');
    g.update([], [], 64);
    expect(g.itemsOf(7)).toHaveLength(0);
    expect(g.root.children).toHaveLength(0);
  });

  it('item spots: deterministic, within the tile', () => {
    expect(itemSpot(3, 2)).toEqual(itemSpot(3, 2));
    for (let k = 0; k < 4; k++) {
      const [dx, dz] = itemSpot(11, k);
      expect(Math.hypot(dx, dz)).toBeLessThan(0.3);
    }
  });
});
