import type { BufferGeometry, MeshStandardMaterial } from 'three';
import type { TownKit } from '../../world/town/kit.js';
import { buildCellLut } from './kit-layers.js';
import { LAYER } from './layers.js';
import { toKitGeometry } from './models.js';
import {
  lutTexture,
  makeKitMaterial,
  makeTerrainMaterial,
  type PbrUniforms,
} from './pbr-material.js';

/** Palette grid of the town atlas (`world/town/skins.ts`). */
export const TOWN_GRID = 16;

/** Kit props replaced by Designer's models in the real style (kit name → model id). */
export const KIT_PROP_MODELS: Readonly<Record<string, string>> = {
  'prop-tree': 'drzewo-lisciaste',
  'prop-tree-autumn': 'drzewo-lisciaste',
  'prop-tree-large': 'drzewo-lisciaste',
  'prop-tree-small': 'drzewo-lisciaste',
  'prop-tree-tall': 'drzewo-lisciaste',
  // Grass tufts of the town decor: Designer's bush in the realistic style.
  'prop-grass-large': 'krzak',
};

/** Height (m) a replacing model is fitted to instead of the old prop's height. */
export const KIT_PROP_HEIGHT: Readonly<Record<string, number>> = {
  'prop-grass-large': 0.85,
};

/** Palette cell standing in for a model layer when a model joins the kit batches. */
const LAYER_CELL: Readonly<Record<number, string>> = {
  [LAYER.trawa]: 'grass-b',
  [LAYER.drewno]: 'trim-wood',
  [LAYER.beton]: 'concrete',
  [LAYER.papa]: 'roof-gravel',
  [LAYER.szklo]: 'glass',
};

function boxHeight(g: BufferGeometry | undefined): number | undefined {
  if (!g) return undefined;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  return bb ? bb.max.y - bb.min.y : undefined;
}

/**
 * The town kit drawn in the realistic style: the same geometry Map (same modules, same batches),
 * the kit material swapped for its `deadzone-pbr/kit` version, tree props replaced by Designer's
 * tree (fitted to the old height) and a PBR terrain material. The input kit is not modified.
 */
export function realTownKit(
  kit: TownKit,
  u: PbrUniforms,
  models: ReadonlyMap<string, BufferGeometry>,
): TownKit {
  const cells = kit.cellIndex ?? {};
  const lut = lutTexture(buildCellLut(cells, TOWN_GRID), TOWN_GRID);
  const material: MeshStandardMaterial = makeKitMaterial(kit.material, u, lut);
  const geometries = new Map(kit.geometries);
  const cellUv = (layer: number): readonly [number, number] =>
    cells[LAYER_CELL[layer] ?? 'paint']?.uv ?? kit.cells.uv('paint');
  for (const [name, id] of Object.entries(KIT_PROP_MODELS)) {
    const src = models.get(id);
    if (!src || !geometries.has(name)) continue;
    const height = KIT_PROP_HEIGHT[name] ?? boxHeight(geometries.get(name));
    geometries.set(name, toKitGeometry(src, cellUv, height));
  }
  return {
    geometries,
    material,
    cells: kit.cells,
    detail: kit.detail,
    cellIndex: cells,
    terrainMaterial: makeTerrainMaterial(u),
  };
}
