import { ModManifestSchema, type ModManifest } from '../schemas/mod-manifest.js';
import type { ErrorSink } from './errors.js';
import type { LoadedPack } from './split-pack.js';
import { reportZodError } from './zod-issues.js';

export function parseManifest(pack: LoadedPack, sink: ErrorSink): ModManifest | undefined {
  if (!pack.manifest) {
    const jsonBroken = sink.errors.some((e) => e.pack === pack.dir && e.file === 'mod.json');
    if (!jsonBroken) {
      sink.add({
        code: 'manifest',
        message: 'brak mod.json',
        pack: pack.dir,
        file: 'mod.json',
        path: '$',
      });
    }
    return undefined;
  }
  const res = ModManifestSchema.safeParse(pack.manifest.raw);
  if (!res.success) {
    reportZodError(res.error, pack.manifest.source, sink);
    return undefined;
  }
  return res.data;
}
