/**
 * Sneak toggle (HUD v2 spec „Skradanie (klawisz C)”, sim #205 protocol 23): the crouch action
 * (`C`) flips sneaking with `setSneak {on}`. The sim owns the state: run / sprint turn it off, so
 * the client follows `CharacterView.sneaking` and only bridges the gap until the view confirms a
 * press (no local-only toggle that could drift from the sim).
 */

/** After switching sneak on, the noise circle shows for this long whatever the setting. */
export const SNEAK_REVEAL_MS = 2000;
/** A press the view has not confirmed by then is dropped (e.g. sprint switched it off at once). */
export const SNEAK_PENDING_MS = 1000;

export class SneakToggle {
  private viewSneaking = false;
  private pending: { on: boolean; atMs: number } | undefined;
  private revealUntilMs = -Infinity;

  constructor(private readonly send: (on: boolean) => void) {}

  /** Own `CharacterView.sneaking` (view `characters[]`). */
  setView(sneaking: boolean): void {
    this.viewSneaking = sneaking;
    if (this.pending?.on === sneaking) this.pending = undefined;
  }

  /** Sneaking as shown by the client: the sim's view, or a press still waiting for it. */
  sneaking(nowMs: number): boolean {
    if (this.pending && nowMs - this.pending.atMs >= SNEAK_PENDING_MS) this.pending = undefined;
    return this.pending?.on ?? this.viewSneaking;
  }

  /** Key press: sends the opposite of the current state; returns the requested state. */
  toggle(nowMs: number): boolean {
    const on = !this.sneaking(nowMs);
    this.pending = { on, atMs: nowMs };
    this.revealUntilMs = on ? nowMs + SNEAK_REVEAL_MS : -Infinity;
    this.send(on);
    return on;
  }

  /** Within SNEAK_REVEAL_MS of switching sneak on (the noise circle ignores „Tylko głośne”). */
  revealing(nowMs: number): boolean {
    return nowMs < this.revealUntilMs;
  }
}
