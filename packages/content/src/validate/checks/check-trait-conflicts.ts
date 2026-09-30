import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

/**
 * Konflikty cech są symetryczne: wystarczy wpis po jednej stronie.
 * Błąd, gdy zawód nadaje za darmo dwie cechy, które się wykluczają.
 */
export function checkTraitConflicts(index: ContentIndex, sink: ErrorSink): void {
  const traits = index.map('trait');
  const conflict = (a: string, b: string): boolean =>
    (traits.get(a)?.data.conflicts.includes(b) ?? false) ||
    (traits.get(b)?.data.conflicts.includes(a) ?? false);

  for (const def of index.map('profession').values()) {
    const free = def.data.freeTraits;
    free.forEach((a, i) => {
      for (const b of free.slice(i + 1)) {
        if (!conflict(a, b)) continue;
        sink.add({
          code: 'trait_conflict',
          message: `zawód „${def.id}” nadaje wykluczające się cechy „${a}” i „${b}”`,
          pack: def.source.pack,
          file: def.source.file,
          path: formatJsonPath([...def.source.path, 'freeTraits', i]),
        });
      }
    });
  }
}
