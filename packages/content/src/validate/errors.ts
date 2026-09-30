/** Kody błędów walidatora. */
export type ContentErrorCode =
  | 'io'
  | 'json_parse'
  | 'manifest'
  | 'unknown_folder'
  | 'schema'
  | 'namespace'
  | 'duplicate_id'
  | 'missing_ref'
  | 'missing_tag'
  | 'wrong_kind'
  | 'bad_override'
  | 'loot_cycle'
  | 'trait_conflict'
  | 'unlearnable_recipe'
  | 'dependency'
  | 'map'
  | 'combine_too_many_parts'
  | 'combine_has_station'
  | 'station_level_missing'
  | 'station_level_gap'
  | 'station_item_mismatch'
  | 'station_upgrade_missing'
  | 'vhs_no_tv'
  | 'vhs_duplicate_skill'
  | 'zone_duplicate_id'
  | 'zone_empty'
  | 'zone_out_of_bounds'
  | 'mode_map_missing'
  | 'mode_zone_role_missing'
  | 'mode_zone_id_missing';

export interface ContentError {
  code: ContentErrorCode;
  message: string;
  /** Katalog paczki (tak jak podany do walidatora). */
  pack: string;
  /** Ścieżka pliku względem katalogu paczki, separator `/`. */
  file: string;
  /** Ścieżka JSON wewnątrz pliku, np. `$[2].ingredients[0].item`. */
  path: string;
}

/** Zbiera błędy; przekazywany do wszystkich kroków walidacji. */
export class ErrorSink {
  readonly errors: ContentError[] = [];
  add(error: ContentError): void {
    this.errors.push(error);
  }
}
