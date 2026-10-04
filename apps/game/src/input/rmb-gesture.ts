/**
 * Right mouse button like Project Zomboid: held = aim / ready (the body faces the cursor, LMB
 * attacks), a short click = the context action (the car menu at a car, otherwise a shove). A click
 * is a release within `CLICK_MS` with no LMB in between; a longer hold is only aiming.
 */
export const RMB_CLICK_MS = 250;

export class RmbGesture {
  private downAt: number | undefined;
  private attacked = false;

  /** RMB pressed. */
  press(now: number): void {
    this.downAt = now;
    this.attacked = false;
  }

  /** LMB pressed while RMB is held (an attack from the aim): the release is no longer a click. */
  attack(): void {
    if (this.downAt !== undefined) this.attacked = true;
  }

  /** RMB released; true = it was a click (run the context action). */
  release(now: number): boolean {
    const at = this.downAt;
    this.downAt = undefined;
    return at !== undefined && !this.attacked && now - at < RMB_CLICK_MS;
  }

  /** Window closed, death, pause: forget the press. */
  cancel(): void {
    this.downAt = undefined;
  }
}
