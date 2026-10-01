import type { NearbyContainerView } from '@deadzone/protocol';
import type { GameState } from '../../state/game-state.js';
import { actionProgress, nearestContainer } from '../hud-model.js';
import { containerName } from '../labels.js';
import { InteractHold, SEARCH_HOLD_MS, type HoldEvent, type HoldTarget } from './interact-hold.js';
import type { PromptVM } from './interact-prompt.js';

/** Height (m) above the floor where the prompt / ring is anchored. */
const ANCHOR_HEIGHT = 0.9;
/** Ring label of a spot search (tile, bush, ditch). */
export const SPOT_NAME = 'Okolica';

/** World storage and zombie corpses need a search before their contents show (sim §9.20). */
export const needsSearch = (c: NearbyContainerView): boolean =>
  (c.kind === 'world' || c.kind === 'corpse') && !c.searched;

export interface InteractHost {
  state(): GameState;
  /** Player position in sim coords (undefined before the first snapshot). */
  player(): { x: number; y: number } | undefined;
  /** Interact key still down. */
  held(): boolean;
  /** Moved or attacked this frame (cancels before the search starts, spec §6). */
  interrupted(): boolean;
  /** A modal window (inventory, loot, workshop) is open. */
  windowOpen(): boolean;
  /** Old single-press behaviour: put all / close / cancel. */
  legacy(): void;
  open(container: number): void;
  search(target: HoldTarget): void;
  cancel(): void;
  /** Sim point (x, y, z level, height m) -> CSS px in the HUD root, undefined when off screen. */
  project(x: number, y: number, z: number, h: number): { x: number; y: number } | undefined;
  key(): string;
  tickMs: number;
}

/**
 * F interaction (HUD v2 §6): a tap opens; holding F sends the sim `search` (container, corpse
 * or the spot under the player, 3.5 s) and the ring follows the sim action's progress. On
 * completion the sim opens the container, so the loot window shows it beside the inventory.
 * Releasing F cancels the search; moving / attacking interrupt it in the sim.
 */
export class InteractController {
  private readonly hold = new InteractHold();

  constructor(private readonly host: InteractHost) {}

  private nearest(): NearbyContainerView | undefined {
    const p = this.host.player();
    return p ? nearestContainer(this.host.state().nearby, p.x, p.y) : undefined;
  }

  private target(): HoldTarget | undefined {
    const p = this.host.player();
    if (!p) return undefined;
    const c = this.nearest();
    return c ? { container: c.id } : { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  press(now: number): void {
    const s = this.host.state();
    if (this.host.windowOpen() || s.container || s.action) {
      this.host.legacy();
      return;
    }
    this.handle(this.hold.press(now, this.target()));
  }

  private handle(ev: HoldEvent | undefined): void {
    if (!ev) return;
    const h = this.host;
    if (ev.type === 'tap') {
      // TODO(doors): a tap without a container should use the door / object in reach once the
      // sim map carries doors.
      if (ev.target && 'container' in ev.target) h.open(ev.target.container);
    } else if (ev.type === 'start') {
      const t = ev.target;
      if ('container' in t) {
        const c = h.state().nearby.find((n) => n.id === t.container);
        if (c && !needsSearch(c)) h.open(c.id);
        else h.search(t);
      } else h.search(t);
    } else if (ev.type === 'release') {
      if (h.state().action?.kind === 'search') h.cancel();
    }
  }

  /** Per frame: advances the hold and returns the prompt to draw. */
  frame(now: number, tick: number): PromptVM {
    const h = this.host;
    if (this.hold.active) {
      const interrupted = h.interrupted() || h.windowOpen();
      this.handle(this.hold.update(now, { held: h.held(), target: this.target(), interrupted }));
    }
    const s = h.state();
    const p = h.player();
    if (!p || h.windowOpen() || s.container) return { mode: 'hidden' };
    const key = h.key();
    const action = s.action?.kind === 'search' ? s.action : undefined;
    if (action || this.hold.searching) {
      const box =
        action?.container !== undefined
          ? s.nearby.find((n) => n.id === action.container)
          : action?.spot || !this.hold.searching
            ? undefined
            : this.nearest();
      const spot = action?.spot ?? { x: Math.floor(p.x), y: Math.floor(p.y), z: 0 };
      const at = box
        ? h.project(box.x + 0.5, box.y + 0.5, box.z, ANCHOR_HEIGHT)
        : h.project(spot.x + 0.5, spot.y + 0.5, spot.z, 0.2);
      if (!at) return { mode: 'hidden' };
      return {
        mode: 'search',
        ...at,
        key,
        progress: action ? (actionProgress(s, tick) ?? action.progress ?? 0) : 0,
        name: box ? containerName(box.type, box.kind) : SPOT_NAME,
        seconds: action
          ? ((action.endTick - action.startTick) * h.tickMs) / 1000
          : SEARCH_HOLD_MS / 1000,
      };
    }
    if (s.action) return { mode: 'hidden' };
    const c = this.nearest();
    if (!c) return { mode: 'hidden' };
    const at = h.project(c.x + 0.5, c.y + 0.5, c.z, ANCHOR_HEIGHT);
    if (!at) return { mode: 'hidden' };
    return { mode: 'prompt', ...at, key, search: needsSearch(c) };
  }
}
