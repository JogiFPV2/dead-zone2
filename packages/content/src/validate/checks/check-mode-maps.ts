import { modeZoneRefs } from '../../schemas/game-mode/mode-zone-refs.js';
import type { ContentIndex } from '../content-index.js';
import type { ContentErrorCode, ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import type { MapData } from '../maps/map-data.js';

/**
 * Tryb z `map`: mapa istnieje w paczkach, każda rola z `requiredZones` ma co najmniej jedną
 * strefę, a każde odwołanie `{ zone: id }` wskazuje istniejącą strefę tej mapy.
 */
export function checkModeMaps(
  index: ContentIndex,
  maps: readonly MapData[],
  sink: ErrorSink,
): void {
  const byId = new Map(maps.map((m) => [m.id, m]));
  for (const def of index.map('gameMode').values()) {
    const mode = def.data;
    if (mode.map === undefined) continue;
    const err = (code: ContentErrorCode, message: string, path: (string | number)[]) =>
      sink.add({
        code,
        message,
        pack: def.source.pack,
        file: def.source.file,
        path: formatJsonPath([...def.source.path, ...path]),
      });
    const map = byId.get(mode.map);
    if (!map) {
      err('mode_map_missing', `tryb „${def.id}” wskazuje nieistniejącą mapę „${mode.map}”`, [
        'map',
      ]);
      continue;
    }
    const zones = map.manifest.zones ?? [];
    const roles = new Set(zones.map((z) => z.role));
    const ids = new Set(zones.map((z) => z.id));
    mode.requiredZones.forEach((role, i) => {
      if (!roles.has(role))
        err('mode_zone_role_missing', `mapa „${map.id}” nie ma strefy z rolą „${role}”`, [
          'requiredZones',
          i,
        ]);
    });
    for (const { ref, path } of modeZoneRefs(mode).zones) {
      if ('zone' in ref && !ids.has(ref.zone))
        err('mode_zone_id_missing', `mapa „${map.id}” nie ma strefy „${ref.zone}”`, path);
    }
  }
}
