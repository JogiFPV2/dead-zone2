export {
  PlanChunkGenerator,
  CHUNK_KINDS,
  FUEL_PUMP,
  VEHICLE_TYPE,
  hash01,
  type GenBuildingMeta,
  type GenColumn,
  type GenLevel,
  type GenRoad,
} from './generator.js';
export {
  chunkInfra,
  HV_SAG,
  LV_SAG,
  MW_SAG,
  type GenInfra,
  type GenPole,
  type GenSpan,
} from './infra.js';
export { coverZones, maskRects, type GenCoverZone } from './cover.js';
export { FOOT, footBlockers } from './infra.js';
export {
  EDGE_PALETTE,
  GROUND_TILES,
  OUTDOOR_FLOORS,
  PROP_FLOORS,
  TILE_PALETTE,
  type EdgeKind,
} from './palette.js';
export {
  GENERATOR_REV,
  generatorVersionNumber,
  type LandCover,
  type PlanFeatures,
  type WorldPlanInput,
} from './plan.js';
export { OSM_REGIONS, OSM_WORLD_CHUNKS, osmPlan, plan4Plan, planFeatures } from './sources.js';
export type { OsmMap } from '../osm/types.js';
export {
  OSM_PIVOT,
  OSM_ROTATION_DEG,
  OSM_SHIFT,
  OSM_WORLD_SIZE,
  SQUARE_TOLERANCE_DEG,
  dominantRoadAngle,
  rotatePt,
  rotation,
  straightenOsmMap,
  unrotatePt,
} from './straighten.js';
export { alignBuildingsToGrid, type GridAlignStats } from './grid-align.js';
export {
  OSM_TILES_FORMAT,
  OSM_TILE_SIZE,
  OsmTiles,
  osmWorldBounds,
  packKinds,
  splitOsmMap,
  tiledPlanInput,
  unpackKinds,
  type OsmTileManifest,
  type OsmTileRef,
} from './tiles.js';
export { columnFootprintIssues, type ColumnFootprintIssue } from './footprint-check.js';
export { surfaceIssues } from '../footprint-check.js';
