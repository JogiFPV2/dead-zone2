import { chunkFileName } from '../../schemas/map/address.js';
import { MapChunkSchema, type MapChunk } from '../../schemas/map/chunk.js';
import { MAP_CHUNKS_FOLDER, MAP_MANIFEST_FILE } from '../../schemas/map/constants.js';
import { MapManifestSchema } from '../../schemas/map/manifest.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import { reportZodError } from '../zod-issues.js';
import type { RawMap } from './collect-map-files.js';
import type { MapData } from './map-data.js';

/**
 * Waliduje manifest i chunki mapy schematami oraz zgodność plików z manifestem:
 * manifest wymienia dokładnie pliki obecne w `chunks/`, a adres chunka zgadza się z nazwą pliku.
 */
export function parseMap(raw: RawMap, namespace: string, sink: ErrorSink): MapData | undefined {
  const base = `maps/${raw.folder}`;
  const err = (file: string, message: string, ...path: (string | number)[]) =>
    sink.add({ code: 'map', message, pack: raw.pack, file, path: formatJsonPath(path) });

  let manifest;
  if (!raw.manifest) err(`${base}/${MAP_MANIFEST_FILE}`, `mapa „${raw.folder}” nie ma manifestu`);
  else {
    const res = MapManifestSchema.safeParse(raw.manifest.raw);
    if (res.success) manifest = res.data;
    else reportZodError(res.error, raw.manifest.source, sink);
  }

  const chunks: MapChunk[] = [];
  const chunkFiles: string[] = [];
  for (const [name, doc] of raw.chunks) {
    const res = MapChunkSchema.safeParse(doc.raw);
    if (!res.success) {
      reportZodError(res.error, doc.source, sink);
      continue;
    }
    const expected = chunkFileName(res.data.address);
    if (expected !== name) {
      err(
        doc.source.file,
        `adres chunka nie zgadza się z nazwą pliku (oczekiwano ${expected})`,
        'address',
      );
    }
    chunks.push(res.data);
    chunkFiles.push(doc.source.file);
  }

  if (!manifest) return undefined;
  const listed = new Set(manifest.chunks.map(chunkFileName));
  manifest.chunks.forEach((a, i) => {
    const name = chunkFileName(a);
    if (!raw.chunks.has(name)) {
      err(`${base}/${MAP_MANIFEST_FILE}`, `brak pliku ${MAP_CHUNKS_FOLDER}/${name}`, 'chunks', i);
    }
  });
  for (const [name, doc] of raw.chunks) {
    if (!listed.has(name)) err(doc.source.file, `chunk ${name} nie jest wymieniony w manifeście`);
  }
  const { pack, folder } = raw;
  return { id: `${namespace}:${folder}`, pack, folder, manifest, chunks, chunkFiles };
}
