import { NAMESPACE_PATTERN } from '../../schemas/common/id.js';
import { MAP_CHUNKS_FOLDER, MAP_MANIFEST_FILE } from '../../schemas/map/constants.js';
import type { ErrorSink } from '../errors.js';
import type { RawDocument } from '../split-pack.js';

/** Surowe pliki jednej mapy przed walidacją schematem. */
export interface RawMap {
  pack: string;
  folder: string;
  manifest: RawDocument | undefined;
  /** Nazwa pliku w `chunks/` → dokument. */
  chunks: Map<string, RawDocument>;
}

/**
 * Grupuje pliki z `maps/` po mapie. Dozwolone są tylko `maps/<mapId>/manifest.json`
 * i `maps/<mapId>/chunks/<plik>.json`, `mapId` w kebab-case.
 */
export function collectMapFiles(docs: readonly RawDocument[], sink: ErrorSink): RawMap[] {
  const maps = new Map<string, RawMap>();
  for (const doc of docs) {
    const [, folder = '', ...rest] = doc.source.file.split('/');
    const isManifest = rest.length === 1 && rest[0] === MAP_MANIFEST_FILE;
    const isChunk = rest.length === 2 && rest[0] === MAP_CHUNKS_FOLDER;
    if (!NAMESPACE_PATTERN.test(folder) || (!isManifest && !isChunk)) {
      sink.add({
        code: 'unknown_folder',
        message: `plik mapy poza układem maps/<mapId>/${MAP_MANIFEST_FILE} i maps/<mapId>/${MAP_CHUNKS_FOLDER}/*.json (mapId w kebab-case)`,
        pack: doc.source.pack,
        file: doc.source.file,
        path: '$',
      });
      continue;
    }
    let map = maps.get(folder);
    if (!map) {
      map = { pack: doc.source.pack, folder, manifest: undefined, chunks: new Map() };
      maps.set(folder, map);
    }
    if (isManifest) map.manifest = doc;
    else map.chunks.set(rest[1]!, doc);
  }
  return [...maps.values()];
}
