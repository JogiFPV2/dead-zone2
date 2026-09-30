import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

/** Zagnieżdżone loot tables nie mogą tworzyć cyklu (A → B → A). */
export function checkLootCycles(index: ContentIndex, sink: ErrorSink): void {
  const tables = index.map('lootTable');
  const state = new Map<string, 'visiting' | 'done'>();
  const reported = new Set<string>();

  const visit = (id: string, stack: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      const key = [...cycle].sort().join(',');
      const def = tables.get(id);
      if (def && !reported.has(key)) {
        reported.add(key);
        sink.add({
          code: 'loot_cycle',
          message: `cykl w loot tables: ${cycle.join(' → ')}`,
          pack: def.source.pack,
          file: def.source.file,
          path: formatJsonPath([...def.source.path, 'entries']),
        });
      }
      return;
    }
    const def = tables.get(id);
    if (!def) return;
    state.set(id, 'visiting');
    for (const e of def.data.entries) if ('table' in e) visit(e.table, [...stack, id]);
    state.set(id, 'done');
  };

  for (const id of tables.keys()) visit(id, []);
}
