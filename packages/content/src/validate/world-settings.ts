import { WorldSettingsSchema, type WorldSettings } from '../schemas/world-settings.js';
import { deepMerge } from './deep-merge.js';
import type { ErrorSink } from './errors.js';
import type { RawDocument } from './split-pack.js';
import { reportZodError } from './zod-issues.js';

/**
 * Łączy `world-settings.json` paczek w kolejności wczytywania (głęboki merge).
 * Każde pole ma wartość domyślną, więc każdy plik waliduje się też samodzielnie — błąd wskazuje plik.
 */
export function mergeWorldSettings(docs: readonly RawDocument[], sink: ErrorSink): WorldSettings {
  let merged: unknown = {};
  for (const doc of docs) {
    const res = WorldSettingsSchema.safeParse(doc.raw);
    if (!res.success) {
      reportZodError(res.error, doc.source, sink);
      continue;
    }
    merged = deepMerge(merged, doc.raw);
  }
  return WorldSettingsSchema.parse(merged);
}
