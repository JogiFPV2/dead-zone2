import type { AreaKind, BuildingKind, BuildingType, RoadKind, Source } from './types.js';

export type Tags = Readonly<Record<string, string>>;

/** Catalogue type each kind is drawn as (kinds without a type of their own borrow the closest). */
export const KIND_TYPE: Record<BuildingKind, BuildingType> = {
  house: 'house',
  block: 'kostka',
  kostka: 'kostka',
  shop: 'grocery',
  pharmacy: 'pharmacy',
  hospital: 'hospital',
  school: 'school',
  gym: 'gym',
  church: 'gym',
  police: 'police',
  'fire-station': 'police',
  office: 'school',
  station: 'grocery',
  fuel: 'gas-station',
  industrial: 'shack',
  garage: 'shack',
  shed: 'shack',
  ruin: 'ruin',
};

const SHOP_FOOD = new Set([
  'supermarket',
  'convenience',
  'grocery',
  'general',
  'bakery',
  'butcher',
  'greengrocer',
  'kiosk',
  'alcohol',
  'beverages',
  'deli',
  'variety_store',
  'department_store',
  'mall',
  'farm',
  'confectionery',
]);

/** Kind from the building's own tags (and tags of POIs inside it); undefined = nothing telling. */
export function kindFromTags(t: Tags): BuildingKind | undefined {
  const b = t.building ?? 'yes';
  const am = t.amenity;
  if (b === 'ruins' || t.ruins === 'yes' || b === 'collapsed' || t['abandoned:building'])
    return 'ruin';
  if (b === 'construction') return 'ruin';
  if (am === 'hospital' || am === 'clinic' || b === 'hospital' || t.healthcare === 'hospital')
    return 'hospital';
  if (am === 'pharmacy' || t.healthcare === 'pharmacy' || t.shop === 'chemist') return 'pharmacy';
  if (am === 'fuel' || b === 'fuel') return 'fuel';
  if (am === 'police' || b === 'police') return 'police';
  if (am === 'fire_station' || b === 'fire_station') return 'fire-station';
  if (
    ['school', 'kindergarten', 'university', 'college'].includes(b) ||
    ['school', 'kindergarten', 'college', 'university'].includes(am ?? '')
  )
    return 'school';
  if (
    ['sports_hall', 'sports_centre', 'gym', 'stadium', 'riding_hall'].includes(b) ||
    ['sports_centre', 'fitness_centre', 'sports_hall'].includes(t.leisure ?? '')
  )
    return 'gym';
  if (
    ['church', 'chapel', 'cathedral', 'religious', 'basilica', 'monastery'].includes(b) ||
    am === 'place_of_worship'
  )
    return 'church';
  if (['train_station', 'transportation'].includes(b) || t.railway === 'station') return 'station';
  if (t.shop && (SHOP_FOOD.has(t.shop) || b === 'retail' || b === 'supermarket')) return 'shop';
  if (['retail', 'supermarket', 'kiosk'].includes(b) || t.shop) return 'shop';
  if (
    ['office', 'public', 'civic', 'government', 'townhall', 'commercial', 'bank', 'hotel'].includes(
      b,
    ) ||
    t.office ||
    ['townhall', 'bank', 'post_office', 'library', 'courthouse', 'community_centre'].includes(
      am ?? '',
    )
  )
    return 'office';
  if (
    [
      'industrial',
      'warehouse',
      'manufacture',
      'factory',
      'hangar',
      'storage_tank',
      'silo',
      'hall',
    ].includes(b) ||
    t.man_made === 'works' ||
    t.craft
  )
    return 'industrial';
  if (['garage', 'garages', 'carport', 'parking'].includes(b)) return 'garage';
  if (
    [
      'shed',
      'outbuilding',
      'hut',
      'farm_auxiliary',
      'barn',
      'cowshed',
      'stable',
      'greenhouse',
      'allotment_house',
      'roof',
      'service',
      'toilets',
      'transformer_tower',
      'sty',
      'boathouse',
      'cabin',
      'bunker',
    ].includes(b)
  )
    return 'shed';
  if (['apartments', 'dormitory'].includes(b)) return 'block';
  if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm'].includes(b))
    return 'house';
  if (b === 'residential') return 'block';
  return undefined;
}

/** Kind from the surrounding landuse and the footprint (area m², longest side m). */
export function kindFromContext(
  landuse: AreaKind | undefined,
  area: number,
  long: number,
): { kind: BuildingKind; from: Source } {
  if (area < 30) return { kind: 'shed', from: 'default' };
  if (landuse === 'industrial' || landuse === 'railway' || landuse === 'military')
    return { kind: area < 60 ? 'shed' : 'industrial', from: 'landuse' };
  if (landuse === 'commercial') return { kind: area > 2000 ? 'shop' : 'office', from: 'landuse' };
  if (landuse === 'allotments') return { kind: 'shed', from: 'landuse' };
  if (landuse === 'farmland' || landuse === 'meadow' || landuse === 'orchard')
    return { kind: area < 90 ? 'shed' : area > 900 ? 'industrial' : 'house', from: 'landuse' };
  if (landuse === 'residential') {
    if (area < 50) return { kind: 'garage', from: 'landuse' };
    if (area > 400 || long > 40) return { kind: 'block', from: 'landuse' };
    return { kind: 'house', from: 'landuse' };
  }
  if (area < 60) return { kind: 'shed', from: 'default' };
  if (area > 1500) return { kind: 'industrial', from: 'default' };
  return { kind: 'house', from: 'default' };
}

/** Deterministic 0..1 from an OSM id (default floor counts). */
export function idHash(id: number, salt = 0): number {
  let h = (Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Highest storey number we generate (blueprint z ≤ 15 → 16 storeys). */
export const MAX_LEVELS = 16;

/** Storeys from `building:levels` (or floor(`height` / 2.8 m)); undefined = not tagged. */
export function levelsFromTags(t: Tags): number | undefined {
  const raw = t['building:levels'] ?? t.levels;
  if (raw) {
    const nums = raw
      .split(/[;,-]/)
      .map((s) => Number.parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (nums.length) return Math.min(MAX_LEVELS, Math.max(1, Math.round(Math.max(...nums))));
  }
  const h = t.height ? Number.parseFloat(t.height) : NaN;
  if (Number.isFinite(h) && h > 0) return Math.min(MAX_LEVELS, Math.max(1, Math.floor(h / 2.8)));
  return undefined;
}

/**
 * Default storeys by kind (Paweł's rules): large-panel block 4–11, mostly 4 or 10–11 (long slabs
 * 4–5, compact point blocks 10–11); house 1–2; hospital 3–5; church 1 tall; others by kind.
 */
export function defaultLevels(kind: BuildingKind, id: number, area: number, long: number): number {
  const r = idHash(id, 7);
  switch (kind) {
    case 'block': {
      if (area < 300) return r < 0.5 ? 2 : 3;
      if (long >= 50) return r < 0.7 ? 4 : 5;
      if (long <= 32 && area >= 350) return r < 0.5 ? 10 : 11;
      return r < 0.45 ? 4 : r < 0.75 ? 11 : r < 0.9 ? 10 : 5 + Math.floor(idHash(id, 8) * 5);
    }
    case 'house':
      return area > 110 ? (r < 0.75 ? 2 : 1) : r < 0.35 ? 2 : 1;
    case 'kostka':
      return 2;
    case 'hospital':
      return 3 + Math.floor(r * 3);
    case 'school':
      return area > 1200 ? 3 : 2;
    case 'office':
      return area > 600 ? 3 + Math.floor(r * 2) : 2;
    case 'shop':
    case 'pharmacy':
      return area > 1500 ? 1 : r < 0.6 ? 1 : 2;
    case 'police':
    case 'fire-station':
    case 'station':
      return 2;
    default:
      return 1;
  }
}

export interface RoadClass {
  kind: RoadKind;
  width: number;
  sidewalk: number;
}

/** Road kind, carriageway width and default sidewalks; undefined = not drawn (proposed, etc.). */
export function classifyRoad(t: Tags): RoadClass | undefined {
  const h = t.highway;
  if (!h || t.area === 'yes') return undefined;
  const lanes = t.lanes ? Number.parseInt(t.lanes, 10) : NaN;
  const oneway = t.oneway === 'yes';
  const sep = (side: string) => t[`sidewalk:${side}`] === 'separate' || t.sidewalk === 'separate';
  const tagged = t.sidewalk === 'no' || t.sidewalk === 'none' ? 0 : undefined;
  const sw = (d: number) => (tagged === 0 || (sep('left') && sep('right')) ? 0 : d);
  const w = (lanesDefault: number, laneW: number) =>
    Math.round((Number.isFinite(lanes) ? lanes : lanesDefault) * laneW);
  switch (h) {
    case 'motorway':
    case 'trunk':
      return { kind: h, width: oneway ? w(2, 3.5) : w(4, 3.5), sidewalk: 0 };
    case 'motorway_link':
    case 'trunk_link':
    case 'primary_link':
    case 'secondary_link':
      return { kind: 'secondary', width: 5, sidewalk: 0 };
    case 'primary':
      return { kind: 'primary', width: oneway ? w(2, 3.5) : w(2, 4), sidewalk: sw(2) };
    case 'secondary':
      return { kind: 'secondary', width: oneway ? w(2, 3.5) : w(2, 3.5), sidewalk: sw(2) };
    case 'tertiary':
    case 'tertiary_link':
      return { kind: 'tertiary', width: oneway ? w(1, 4) : 7, sidewalk: sw(2) };
    case 'residential':
    case 'unclassified':
    case 'living_street':
    case 'road':
      return {
        kind: 'residential',
        width: h === 'living_street' ? 5 : 6,
        sidewalk: sw(h === 'unclassified' ? 0 : 1),
      };
    case 'service':
      return { kind: 'service', width: t.service === 'parking_aisle' ? 5 : 4, sidewalk: 0 };
    case 'track':
      return { kind: 'track', width: 3, sidewalk: 0 };
    case 'footway':
    case 'pedestrian':
    case 'platform':
      return { kind: 'footway', width: h === 'pedestrian' ? 6 : 2, sidewalk: 0 };
    case 'path':
    case 'bridleway':
      return { kind: 'path', width: 2, sidewalk: 0 };
    case 'cycleway':
      return { kind: 'cycleway', width: 2, sidewalk: 0 };
    case 'steps':
      return { kind: 'steps', width: 2, sidewalk: 0 };
    default:
      return undefined;
  }
}

/** Area kind of a closed way / multipolygon; undefined = not a ground area we draw. */
export function classifyArea(t: Tags): AreaKind | undefined {
  const n = t.natural;
  const lu = t.landuse;
  const le = t.leisure;
  const am = t.amenity;
  if (n === 'water' || lu === 'reservoir' || lu === 'basin' || t.waterway === 'riverbank')
    return 'water';
  if (n === 'wetland') return 'wetland';
  if (n === 'wood' || lu === 'forest') return 'forest';
  if (n === 'scrub' || n === 'heath') return 'scrub';
  if (n === 'sand' || n === 'beach' || lu === 'quarry') return 'sand';
  if (am === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey')
    return 'parking';
  if (am === 'fuel') return 'fuel';
  if (le === 'park' || le === 'garden' || le === 'playground' || le === 'dog_park') return 'park';
  if (le === 'pitch' || le === 'track' || le === 'stadium' || le === 'sports_centre')
    return 'pitch';
  if (lu === 'cemetery' || am === 'grave_yard') return 'cemetery';
  if (lu === 'railway') return 'railway';
  if (lu === 'allotments') return 'allotments';
  if (lu === 'orchard' || lu === 'vineyard' || lu === 'plant_nursery') return 'orchard';
  if (lu === 'farmland' || lu === 'farmyard' || lu === 'greenhouse_horticulture') return 'farmland';
  if (lu === 'meadow' || n === 'grassland' || lu === 'village_green') return 'meadow';
  if (lu === 'grass' || lu === 'recreation_ground' || le === 'common') return 'grass';
  if (lu === 'residential') return 'residential';
  if (lu === 'industrial' || lu === 'brownfield' || t.man_made === 'works') return 'industrial';
  if (lu === 'commercial' || lu === 'retail') return 'commercial';
  if (lu === 'construction') return 'construction';
  if (lu === 'military') return 'military';
  if (t.highway === 'pedestrian' || t['area:highway'] || am === 'marketplace') return 'paved';
  if (['school', 'kindergarten', 'hospital', 'university', 'college'].includes(am ?? ''))
    return 'grass';
  return undefined;
}
