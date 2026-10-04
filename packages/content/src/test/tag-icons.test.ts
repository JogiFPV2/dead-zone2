import { describe, expect, it } from 'vitest';
import { TagDefSchema } from '../schemas/tag-def.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { material, miniBase } from './helpers.js';

const codes = (r: ReturnType<typeof validatePacks>) => r.errors.map((e) => [e.code, e.path]);

/** Tagi z receptur, pod którymi nie ma żadnego przedmiotu (wtedy brak `iconItem`). Jawnie. */
const TAGS_WITHOUT_ITEM: readonly string[] = [];

describe('definicje tagów (iconItem)', () => {
  it('schemat: id to tag, iconItem opcjonalny, bez nieznanych pól', () => {
    expect(TagDefSchema.parse({ id: 'base:wood-plank' })).toMatchObject({ id: 'base:wood-plank' });
    expect(TagDefSchema.safeParse({ id: 'base:x', icon: 'base:y' }).success).toBe(false);
    expect(TagDefSchema.safeParse({ id: 'nie-tag', iconItem: 'base:y' }).success).toBe(false);
  });

  it('walidator: iconItem musi istnieć i mieć ten tag', () => {
    const items = {
      'items/m.json': [material('base:board', ['base:wood-board']), material('base:pebble')],
    };
    const ok = validatePacks([
      miniBase({ ...items, 'tags/t.json': [{ id: 'base:wood-board', iconItem: 'base:board' }] }),
    ]);
    expect(codes(ok)).toEqual([]);

    const mismatch = validatePacks([
      miniBase({ ...items, 'tags/t.json': [{ id: 'base:wood-board', iconItem: 'base:pebble' }] }),
    ]);
    expect(codes(mismatch)).toEqual([['tag_icon_item_mismatch', '$[0].iconItem']]);

    const missing = validatePacks([
      miniBase({ ...items, 'tags/t.json': [{ id: 'base:wood-board', iconItem: 'base:nope' }] }),
    ]);
    expect(codes(missing)).toEqual([['missing_ref', '$[0].iconItem']]);
  });

  it('paczka bazowa: każdy tag z receptury ma iconItem z tym tagiem', async () => {
    const b = await baseBundle();
    const used = new Set<string>();
    for (const r of Object.values(b.recipes)) {
      for (const p of [...r.ingredients, ...r.tools]) if ('tag' in p && p.tag) used.add(p.tag);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const tag of used) {
      const icon = b.tags[tag]?.iconItem;
      if (TAGS_WITHOUT_ITEM.includes(tag)) {
        expect(icon, tag).toBeUndefined();
        continue;
      }
      expect(icon, `tag ${tag} bez iconItem`).toBeDefined();
      expect(b.items[icon ?? '']?.tags, tag).toContain(tag);
    }
  });
});
