import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

/**
 * Kasety VHS: musi istnieć telewizor (placeable z tagiem `tvTag` i `power`), a umiejętność
 * nie powtarza się w jednej kasecie.
 */
export function checkVhs(index: ContentIndex, sink: ErrorSink): void {
  const items = [...index.map('item').values()];
  const tvs = new Set<string>();
  for (const { data } of items)
    if (data.kind === 'placeable' && data.placeable.power) for (const t of data.tags) tvs.add(t);
  for (const def of items) {
    const item = def.data;
    if (item.kind !== 'vhs') continue;
    const at = (...p: (string | number)[]) => ({
      pack: def.source.pack,
      file: def.source.file,
      path: formatJsonPath([...def.source.path, 'vhs', ...p]),
    });
    if (!tvs.has(item.vhs.tvTag))
      sink.add({
        code: 'vhs_no_tv',
        message: `„${def.id}”: brak telewizora z tagiem „${item.vhs.tvTag}” i zasilaniem`,
        ...at('tvTag'),
      });
    const seen = new Set<string>();
    item.vhs.skills.forEach((s, i) => {
      if (seen.has(s.skill))
        sink.add({
          code: 'vhs_duplicate_skill',
          message: `„${def.id}”: umiejętność „${s.skill}” powtórzona`,
          ...at('skills', i, 'skill'),
        });
      seen.add(s.skill);
    });
  }
}
