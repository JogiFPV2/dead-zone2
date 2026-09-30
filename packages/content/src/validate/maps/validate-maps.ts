import type { ModManifest } from '../../schemas/mod-manifest.js';
import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import type { LoadedPack } from '../split-pack.js';
import { checkMapRefs } from './check-map-refs.js';
import { checkMapRooms } from './check-map-rooms.js';
import { collectMapFiles } from './collect-map-files.js';
import type { MapData } from './map-data.js';
import { parseMap } from './parse-map.js';

/** Waliduje mapy wszystkich paczek (schemat, pliki vs manifest, referencje na końcowym contencie). */
export function validateMaps(
  packs: readonly { pack: LoadedPack; manifest: ModManifest }[],
  index: ContentIndex,
  sink: ErrorSink,
): MapData[] {
  const out: MapData[] = [];
  for (const { pack, manifest } of packs) {
    for (const raw of collectMapFiles(pack.maps, sink)) {
      const map = parseMap(raw, manifest.id, sink);
      if (!map) continue;
      checkMapRooms(map, sink);
      checkMapRefs(map, index, sink);
      out.push(map);
    }
  }
  return out;
}
