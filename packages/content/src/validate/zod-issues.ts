import type { z } from 'zod';
import type { ErrorSink } from './errors.js';
import { formatJsonPath } from './json-path.js';
import type { SourceRef } from './source.js';

/** Zamienia błędy zod na błędy walidatora z pełną ścieżką JSON. */
export function reportZodError(error: z.ZodError, source: SourceRef, sink: ErrorSink): void {
  for (const issue of error.issues) {
    sink.add({
      code: 'schema',
      message: issue.message,
      pack: source.pack,
      file: source.file,
      path: formatJsonPath([...source.path, ...issue.path]),
    });
  }
}
