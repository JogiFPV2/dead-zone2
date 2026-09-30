import { ModOverrideSchema } from '../schemas/mod-override.js';
import { CONTENT_SCHEMAS } from '../schemas/registry.js';
import type { ContentIndex } from './content-index.js';
import { deepMerge } from './deep-merge.js';
import type { ErrorSink } from './errors.js';
import { formatJsonPath } from './json-path.js';
import type { RawDocument } from './split-pack.js';
import { reportZodError } from './zod-issues.js';

/** Stosuje nadpisania paczki na indeksie. Cel musi już istnieć (z tej albo wcześniejszej paczki). */
export function applyOverrides(
  overrides: readonly RawDocument[],
  index: ContentIndex,
  sink: ErrorSink,
): void {
  for (const ov of overrides) {
    const parsed = ModOverrideSchema.safeParse(ov.raw);
    if (!parsed.success) {
      reportZodError(parsed.error, ov.source, sink);
      continue;
    }
    const o = parsed.data;
    const at = (key: string) => ({
      pack: ov.source.pack,
      file: ov.source.file,
      path: formatJsonPath([...ov.source.path, key]),
    });
    const target = index.get(o.type, o.target);
    if (!target) {
      sink.add({
        code: 'bad_override',
        message: `nadpisanie celuje w nieistniejące ${o.type} „${o.target}”`,
        ...at('target'),
      });
      continue;
    }
    if (o.op === 'remove') {
      index.delete(o.type, o.target);
      continue;
    }
    const candidate = o.op === 'merge' ? deepMerge(target.data, o.data) : o.data;
    const res = CONTENT_SCHEMAS[o.type].safeParse(candidate);
    if (!res.success) {
      reportZodError(res.error, { ...ov.source, path: [...ov.source.path, 'data'] }, sink);
      continue;
    }
    if ((res.data as { id: string }).id !== o.target) {
      sink.add({
        code: 'bad_override',
        message: `nadpisanie nie może zmieniać id (${o.target})`,
        ...at('data'),
      });
      continue;
    }
    index.set({ type: o.type, id: o.target, data: res.data, source: target.source });
  }
}
