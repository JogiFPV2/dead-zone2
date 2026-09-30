import type { ContentIndex } from '../content-index.js';
import type { ContentErrorCode, ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

/**
 * Stacje: poziomy 1..n po kolei; przedmiot poziomu jest `placeable` ze `station = { id, level }`;
 * receptura poziomu daje ten przedmiot, a od poziomu 2 zużywa przedmiot poprzedniego poziomu.
 */
export function checkStations(index: ContentIndex, sink: ErrorSink): void {
  const items = index.map('item');
  const recipes = index.map('recipe');
  for (const def of index.map('station').values()) {
    const err = (code: ContentErrorCode, message: string, ...path: (string | number)[]) =>
      sink.add({
        code,
        message,
        pack: def.source.pack,
        file: def.source.file,
        path: formatJsonPath([...def.source.path, 'levels', ...path]),
      });
    const levels = def.data.levels;
    levels.forEach((l, i) => {
      if (l.level !== i + 1)
        err('station_level_gap', `„${def.id}”: poziom ${l.level} na pozycji ${i + 1}`, i, 'level');
      const item = items.get(l.item)?.data;
      const st = item?.kind === 'placeable' ? item.placeable.station : undefined;
      if (item && (st?.id !== def.id || st.level !== l.level))
        err(
          'station_item_mismatch',
          `„${l.item}” nie jest stacją „${def.id}” poziomu ${l.level}`,
          i,
          'item',
        );
      const recipe = recipes.get(l.recipe)?.data;
      if (!recipe) return;
      const prev = levels[i - 1]?.item;
      const makes = recipe.results.some((r) => r.item === l.item);
      const consumes = !prev || recipe.ingredients.some((g) => 'item' in g && g.item === prev);
      if (!makes || !consumes)
        err(
          'station_upgrade_missing',
          `„${l.recipe}” musi dawać „${l.item}”${prev ? ` i zużywać „${prev}”` : ''}`,
          i,
          'recipe',
        );
    });
  }
}
