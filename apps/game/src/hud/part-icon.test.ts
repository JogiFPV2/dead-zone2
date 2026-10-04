import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHudContentIndex } from './content-index.js';
import { partIconItem } from './part-icon.js';

const TAGS_DIR = new URL('../../../../packages/content/data/base/tags/', import.meta.url);
const ICONS = new URL('../../public/icons/index.json', import.meta.url);

/**
 * `iconItem` bez wypieczonej ikony w `public/icons` (część 4 od Designera czeka na import
 * albo przedmiot nie ma jeszcze modelu). Do tego czasu UI pokazuje kostkę. Jawnie.
 */
const PENDING_ICONS = new Set([
  'base:plank',
  'base:log',
  'base:rag',
  'base:sheet',
  'base:t-shirt',
  'base:scrap-metal',
  'base:carrot',
  'base:vodka',
  'base:cooking-pot',
  'base:matches',
  'base:sewing-needle',
  'base:saw',
  'base:screwdriver',
  'base:welding-torch',
  'base:pipe-wrench',
]);

const tagDefs = readdirSync(TAGS_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap(
    (f) =>
      JSON.parse(readFileSync(new URL(f, TAGS_DIR), 'utf8')) as { id: string; iconItem?: string }[],
  );

describe('ikona składnika-tagu w przepisach', () => {
  const content = buildHudContentIndex([
    { path: 'tags/crafting.json', json: [{ id: 'base:wood-plank', iconItem: 'base:plank' }] },
  ] as never);

  it('przedmiot ma pierwszeństwo, tag bierze iconItem, nieznany tag zostaje kostką', () => {
    expect(partIconItem({ item: 'base:nails' }, content)).toBe('base:nails');
    expect(partIconItem({ tag: 'base:wood-plank' }, content)).toBe('base:plank');
    expect(partIconItem({ tag: 'base:unknown' }, content)).toBeUndefined();
    expect(partIconItem({}, content)).toBeUndefined();
  });

  it('każdy iconItem tagu ma ikonę albo jest na liście PENDING_ICONS', () => {
    const icons = JSON.parse(readFileSync(ICONS, 'utf8')) as Record<string, string>;
    expect(tagDefs.length).toBeGreaterThan(0);
    for (const t of tagDefs) {
      if (!t.iconItem) continue;
      if (PENDING_ICONS.has(t.iconItem)) continue;
      expect(icons[t.iconItem], `${t.id} → ${t.iconItem}`).toMatch(/\.png$/);
    }
    for (const id of PENDING_ICONS) {
      expect(icons[id], `${id} ma już ikonę, usuń z PENDING_ICONS`).toBeUndefined();
    }
  });

  it('kawałki szkła mają ikonę', () => {
    const icons = JSON.parse(readFileSync(ICONS, 'utf8')) as Record<string, string>;
    expect(icons['base:glass-shards']).toBe('glass-shards.png');
  });
});
