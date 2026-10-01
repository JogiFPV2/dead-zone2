import type { RenderLook } from '../creator/appearance-map.js';
import { DEFAULT_PORTRAIT } from './character-store.js';
import type { Portrait } from './schema.js';

/** Card portrait colours from a render look (parts: head/hair, top, bottom, shoes). */
export function portraitOf(look: RenderLook | undefined): Portrait {
  if (!look) return DEFAULT_PORTRAIT;
  return {
    skin: look.skin || DEFAULT_PORTRAIT.skin,
    hair: look.parts[0]?.colors.primary ?? DEFAULT_PORTRAIT.hair,
    shirt: look.parts[1]?.colors.primary ?? DEFAULT_PORTRAIT.shirt,
  };
}
