import type { TagDef } from '../../schemas/tag-def.js';
import type { RefList } from './ref-collector.js';

/** Definicja tagu: sam tag musi mieć jakiś przedmiot, `iconItem` musi istnieć. */
export function collectTagDefRefs(tag: TagDef, r: RefList): void {
  r.tags.push({ tag: tag.id, path: ['id'] });
  r.add('item', tag.iconItem, 'iconItem');
}
