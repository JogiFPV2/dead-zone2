import type { WorldSettings } from '../../schemas/world-settings.js';
import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import type { SourceRef } from '../source.js';

const SLOTS = ['empty', 'clean', 'tainted'] as const;

/**
 * `worldSettings.water.bottles`: każda butelka (`empty`, `clean`, `tainted`) to istniejący
 * przedmiot, a `clean` i `tainted` mają `waterContainer` (z niego sim liczy porcję napełniania).
 * Sprawdzane, gdy paczki ustawiają `water` albo mają przedmiot z `waterContainer` (paczka bez
 * wody, np. testowa, nie musi mieć butelek z wartości domyślnych).
 */
export function checkWater(
  index: ContentIndex,
  ws: WorldSettings,
  where: SourceRef,
  explicit: boolean,
  sink: ErrorSink,
): void {
  const items = index.map('item');
  if (!explicit && ![...items.values()].some((d) => d.data.waterContainer)) return;
  for (const slot of SLOTS) {
    const id = ws.water.bottles[slot];
    const at = {
      pack: where.pack,
      file: where.file,
      path: formatJsonPath([...where.path, 'water', 'bottles', slot]),
    };
    const item = items.get(id)?.data;
    if (!item) {
      sink.add({
        code: 'missing_ref',
        message: `water.bottles.${slot}: brak przedmiotu „${id}”`,
        ...at,
      });
      continue;
    }
    if (slot !== 'empty' && !item.waterContainer)
      sink.add({
        code: 'water_bottle_no_container',
        message: `water.bottles.${slot}: „${id}” nie ma waterContainer`,
        ...at,
      });
  }
}
