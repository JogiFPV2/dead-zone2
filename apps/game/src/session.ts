import type { CharacterSpec } from '@deadzone/protocol';
import type { RenderLook } from './creator/appearance-map.js';

/**
 * Hand-off from the menu / creator to the game boot (same page, no reload): the new character
 * goes to the sim with `init({ character })`, the look dresses the player model right away.
 */
export interface NewCharacter {
  spec: CharacterSpec;
  look: RenderLook;
}

let pending: NewCharacter | undefined;

export function setNewCharacter(c: NewCharacter | undefined): void {
  pending = c;
}

/** The creator's character (once; later reads return undefined). */
export function takeNewCharacter(): NewCharacter | undefined {
  const c = pending;
  pending = undefined;
  return c;
}
