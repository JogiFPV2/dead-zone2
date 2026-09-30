import { namespaceOf } from '../schemas/common/id.js';
import { CONTENT_SCHEMAS } from '../schemas/registry.js';
import type { ContentIndex } from './content-index.js';
import type { ErrorSink } from './errors.js';
import { formatJsonPath } from './json-path.js';
import type { RawDefinition } from './split-pack.js';
import { reportZodError } from './zod-issues.js';

/**
 * Waliduje definicje paczki schematem i dodaje je do indeksu.
 * Pilnuje namespace (= id moda) i duplikatów id w obrębie typu (także między paczkami —
 * zmiana cudzej definicji idzie przez `overrides/`).
 */
export function addDefinitions(
  defs: readonly RawDefinition[],
  namespace: string | undefined,
  index: ContentIndex,
  sink: ErrorSink,
): void {
  for (const def of defs) {
    const res = CONTENT_SCHEMAS[def.type].safeParse(def.raw);
    if (!res.success) {
      reportZodError(res.error, def.source, sink);
      continue;
    }
    const id = (res.data as { id: string }).id;
    const at = {
      pack: def.source.pack,
      file: def.source.file,
      path: formatJsonPath([...def.source.path, 'id']),
    };

    if (namespace !== undefined && namespaceOf(id) !== namespace) {
      sink.add({
        code: 'namespace',
        message: `id „${id}” musi mieć namespace paczki „${namespace}:”; do zmiany cudzych definicji użyj overrides/`,
        ...at,
      });
      continue;
    }
    const existing = index.get(def.type, id);
    if (existing) {
      sink.add({
        code: 'duplicate_id',
        message: `zduplikowane id ${def.type} „${id}” (pierwsze w ${existing.source.pack}/${existing.source.file} ${formatJsonPath(existing.source.path)})`,
        ...at,
      });
      continue;
    }
    index.set({ type: def.type, id, data: res.data, source: def.source });
  }
}
