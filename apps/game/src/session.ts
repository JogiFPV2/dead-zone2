import type { CharacterSpec } from '@deadzone/protocol';
import type { CharacterRecord, SaveRecord } from './characters/schema.js';
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

/** A character to play (menu → game): its record, its save (none = new world) and, for a new
 * character, the creator's choice. */
export interface GameSession {
  character: CharacterRecord;
  save?: SaveRecord | undefined;
  created?: NewCharacter | undefined;
}

let session: GameSession | undefined;

export function setSession(s: GameSession | undefined): void {
  session = s;
}

/** The menu's session (once). */
export function takeSession(): GameSession | undefined {
  const s = session;
  session = undefined;
  return s;
}
