import type { ContentIndex } from '../content-index.js';
import type { ContentErrorCode, ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

export const COMBINE_MAX_PARTS = 4;

/**
 * Receptury `combine` (łączenie w ekwipunku): najwyżej 4 części (wpisy `ingredients`, ilość
 * w wpisie dowolna, np. gwoździe ×5), bez stacji. Receptura ze stacją: stacja ma poziom `minLevel`.
 */
export function checkRecipeKinds(index: ContentIndex, sink: ErrorSink): void {
  const stations = index.map('station');
  for (const def of index.map('recipe').values()) {
    const r = def.data;
    const err = (code: ContentErrorCode, message: string, ...path: (string | number)[]) =>
      sink.add({
        code,
        message,
        pack: def.source.pack,
        file: def.source.file,
        path: formatJsonPath([...def.source.path, ...path]),
      });
    if (r.kind === 'combine') {
      const parts = r.ingredients.length;
      if (parts > COMBINE_MAX_PARTS)
        err(
          'combine_too_many_parts',
          `„${def.id}”: ${parts} części, najwyżej ${COMBINE_MAX_PARTS}`,
          'ingredients',
        );
      if (r.station)
        err('combine_has_station', `„${def.id}”: łączenie nie używa stacji`, 'station');
    }
    const st = r.station && stations.get(r.station.id);
    if (r.station && st && !st.data.levels.some((l) => l.level === r.station!.minLevel))
      err(
        'station_level_missing',
        `stacja „${r.station.id}” nie ma poziomu ${r.station.minLevel}`,
        'station',
        'minLevel',
      );
  }
}
