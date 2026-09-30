import { MAP_MANIFEST_FILE } from '../../schemas/map/constants.js';
import type { ContentErrorCode, ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import { floorBounds, rectInside } from './map-bounds.js';
import type { MapData } from './map-data.js';

/** Strefy manifestu: unikalne id, co najmniej jeden prostokąt, prostokąty w granicach piętra. */
export function checkMapZones(map: MapData, sink: ErrorSink): void {
  const file = `maps/${map.folder}/${MAP_MANIFEST_FILE}`;
  const err = (code: ContentErrorCode, message: string, ...path: (string | number)[]) =>
    sink.add({ code, message, pack: map.pack, file, path: formatJsonPath(['zones', ...path]) });
  const seen = new Set<string>();
  (map.manifest.zones ?? []).forEach((zone, i) => {
    if (seen.has(zone.id)) err('zone_duplicate_id', `strefa „${zone.id}” podana dwa razy`, i, 'id');
    seen.add(zone.id);
    if (zone.rects.length === 0)
      err('zone_empty', `strefa „${zone.id}” nie ma prostokątów`, i, 'rects');
    const b = floorBounds(map.manifest, zone.z);
    zone.rects.forEach((r, j) => {
      if (b && rectInside(r, b)) return;
      const where = b
        ? `x ${b.x0}..${b.x1 - 1}, y ${b.y0}..${b.y1 - 1}`
        : `brak chunków na z=${zone.z}`;
      err(
        'zone_out_of_bounds',
        `prostokąt strefy „${zone.id}” poza mapą (${where})`,
        i,
        'rects',
        j,
      );
    });
  });
}
