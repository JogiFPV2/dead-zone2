import type { RejectMissing } from '@deadzone/protocol';
import type { SimWorld } from './world.js';

/**
 * Extra data for the next `commandRejected` (`detail`, `missing`): a validator that rejects
 * notes what was lacking, the input system attaches it to the reject of the command being
 * applied. Not state (never saved or hashed); cleared before every command.
 */
export interface RejectNote {
  detail?: string;
  missing?: RejectMissing;
}

const notes = new WeakMap<SimWorld, RejectNote>();

/** Notes `note` for the reject of the current command (merged with an earlier note). */
export function noteReject(w: SimWorld, note: RejectNote): void {
  const have = notes.get(w);
  notes.set(w, have ? { ...have, ...note } : note);
}

/** Takes (and clears) the note of the current command. */
export function takeRejectNote(w: SimWorld): RejectNote | undefined {
  const n = notes.get(w);
  if (n) notes.delete(w);
  return n;
}
