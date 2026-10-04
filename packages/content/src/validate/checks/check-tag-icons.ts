import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

/**
 * `iconItem` tagu musi mieć ten tag (po nałożeniu modów). Brak przedmiotu zgłasza już
 * `checkRefs` (`missing_ref`), więc tutaj tylko istniejące przedmioty.
 */
export function checkTagIcons(index: ContentIndex, sink: ErrorSink): void {
  for (const def of index.map('tag').values()) {
    const id = def.data.iconItem;
    const item = id === undefined ? undefined : index.get('item', id)?.data;
    if (!item || item.tags.includes(def.id)) continue;
    sink.add({
      code: 'tag_icon_item_mismatch',
      message: `tag „${def.id}”: iconItem „${id}” nie ma tego tagu`,
      pack: def.source.pack,
      file: def.source.file,
      path: formatJsonPath([...def.source.path, 'iconItem']),
    });
  }
}
