import type { HudContentIndex } from './content-index.js';

/**
 * Item whose icon shows for a recipe part: the item itself, or the tag's `iconItem`
 * (`tags/*.json`). `undefined` keeps the placeholder cube.
 */
export const partIconItem = (
  p: { item?: string | undefined; tag?: string | undefined },
  content: Pick<HudContentIndex, 'tagIcons'>,
): string | undefined => p.item ?? (p.tag ? content.tagIcons?.get(p.tag) : undefined);
