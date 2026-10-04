/**
 * F interaction (deadzone-hud-v2-spec §6): a short tap opens / uses; holding F starts the sim
 * search (3.5 s, `search` command, progress from the sim view). Pure state machine; the game
 * feeds it key state and the target in reach.
 */
export const SEARCH_HOLD_MS = 3500;
/** Released before this = a tap; held past it = start the search. */
export const TAP_MS = 250;

/** What a search acts on: a container (or corpse) id, or a spot (tile). */
export type SearchTarget = { container: number } | { x: number; y: number };
/** What F acts on: a search target, or an opening edge (`edgeKey`; hold = its action menu). */
export type HoldTarget = SearchTarget | { edge: string };

const holdKey = (t: HoldTarget): string =>
  'edge' in t ? `e:${t.edge}` : 'container' in t ? `c:${t.container}` : `s:${t.x},${t.y}`;

export const sameTarget = (a: HoldTarget | undefined, b: HoldTarget | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && holdKey(a) === holdKey(b));

export type HoldEvent =
  | { type: 'tap'; target: HoldTarget | undefined }
  | { type: 'start'; target: HoldTarget }
  | { type: 'release' }
  | { type: 'cancel'; reason: 'target' | 'interrupted' };

export interface HoldInput {
  /** Interact key still down. */
  held: boolean;
  /** Target in reach now. */
  target: HoldTarget | undefined;
  /** Moved or attacked this frame. */
  interrupted: boolean;
}

export class InteractHold {
  private start: number | undefined;
  private target: HoldTarget | undefined;
  private started = false;

  get active(): boolean {
    return this.start !== undefined;
  }

  /** The search was started (held past TAP_MS) and the key is still down. */
  get searching(): boolean {
    return this.started;
  }

  /** Key pressed. Without anything in reach it is a tap at once (doors, use). */
  press(now: number, target: HoldTarget | undefined): HoldEvent | undefined {
    if (target === undefined) return { type: 'tap', target: undefined };
    this.start = now;
    this.target = target;
    this.started = false;
    return undefined;
  }

  /** Per frame while active. */
  update(now: number, input: HoldInput): HoldEvent | undefined {
    if (this.start === undefined || this.target === undefined) return undefined;
    const target = this.target;
    if (this.started) {
      // The sim owns the running search (it interrupts on move / attack itself).
      if (input.held) return undefined;
      this.reset();
      return { type: 'release' };
    }
    if (!input.held) {
      this.reset();
      return { type: 'tap', target };
    }
    if (!sameTarget(input.target, target)) {
      this.reset();
      return { type: 'cancel', reason: 'target' };
    }
    if (now - this.start < TAP_MS) return undefined;
    if (input.interrupted) {
      this.reset();
      return { type: 'cancel', reason: 'interrupted' };
    }
    this.started = true;
    return { type: 'start', target };
  }

  reset(): void {
    this.start = undefined;
    this.target = undefined;
    this.started = false;
  }
}
