import type { CharacterProfileView } from '@deadzone/protocol';
import type { Object3D } from 'three';
import { CHARACTER_EMISSIVE } from '../models/zombie-views.js';
import {
  MODEL_ASSET,
  lookFromAppearance,
  type ModelId,
  type RenderLook,
} from './appearance-map.js';
import { CharacterAssembly } from './character-builder.js';
import { basePaletteHex } from './palettes.js';

export { basePaletteHex };

/** Render look of a created character (`view.characterProfile`, e.g. after loading a save). */
export const lookOfProfile = (p: CharacterProfileView): RenderLook =>
  lookFromAppearance(p.appearance, basePaletteHex);

/**
 * Dresses the in-game player model (`root`, a casual clone) in `look`: parts from the three
 * Quaternius templates, with the game's character self-lighting.
 */
export async function dressCharacter(
  root: Object3D,
  look: RenderLook,
  load: (asset: string) => Promise<Object3D>,
): Promise<CharacterAssembly> {
  const ids = Object.keys(MODEL_ASSET) as ModelId[];
  const loaded = await Promise.all(ids.map((id) => load(MODEL_ASSET[id])));
  const templates = Object.fromEntries(ids.map((id, i) => [id, loaded[i]!])) as Record<
    ModelId,
    Object3D
  >;
  const assembly = new CharacterAssembly(root, templates, CHARACTER_EMISSIVE);
  assembly.setLook(look);
  return assembly;
}
