import type { NearbyContainerView } from '@deadzone/protocol';
import type { GameState } from '../../state/game-state.js';
import { actionProgress, nearestContainer } from '../hud-model.js';
import { containerName } from '../labels.js';
import {
  doorCentre,
  doorVerb,
  doorWins,
  edgeKey,
  lockOptions,
  openingMenu,
  openingPrimary,
  type EdgeAction,
  COVER_PICK_LABEL,
  OPENING_ACTION_TITLES,
  type DoorTarget,
  type OpeningCmd,
  type OpeningOption,
} from '../../world/door-target.js';
import {
  InteractHold,
  SEARCH_HOLD_MS,
  type HoldEvent,
  type HoldTarget,
  type SearchTarget,
} from './interact-hold.js';
import type { PromptVM } from './interact-prompt.js';
import type { CoverChoice } from '../window-cover-items.js';

/** „Zasłoń…” with no carried item that can cover a window. */
export const NO_COVER_TOAST = 'Nie masz czym zasłonić';

/** Height (m) above the floor where the prompt / ring is anchored. */
const ANCHOR_HEIGHT = 0.9;
/** Door prompt anchor height (m), about the handle. */
const DOOR_ANCHOR_HEIGHT = 1.2;
/** Ring label of a spot search (tile, bush, ditch). */
export const SPOT_NAME = 'Okolica';

/** World storage and zombie corpses need a search before their contents show (sim §9.20). */
export const needsSearch = (c: NearbyContainerView): boolean =>
  (c.kind === 'world' || c.kind === 'corpse') && !c.searched;

export interface InteractHost {
  state(): GameState;
  /** Player position in sim coords (undefined before the first snapshot). */
  player(): { x: number; y: number } | undefined;
  /** Nearest door / gate / window in reach (`world/door-target.ts`), undefined when none. */
  door(): DoorTarget | undefined;
  /** Sends the sim command `cmd` (`toggleDoor`, `barricade` …) for this edge (`item`: coverWindow). */
  opening(door: DoorTarget, cmd: OpeningCmd, item?: number): void;
  /** The sim's context-menu entries of this edge (door locks); undefined = none known. */
  edgeActions?(door: DoorTarget): readonly EdgeAction[] | undefined;
  /** Runs one entry of the sim's edge menu (`useFurniture`). */
  useEdgeAction?(door: DoorTarget, actionId: string): void;
  /** Carried items that can cover a window (the „Zasłoń…” picker). */
  coverItems?(): readonly CoverChoice[];
  /** Short message (picker with nothing to hang). */
  toast?(text: string): void;
  /** Interact key still down. */
  held(): boolean;
  /** Moved or attacked this frame (cancels before the search starts, spec §6). */
  interrupted(): boolean;
  /** A modal window (inventory, loot, workshop) is open. */
  windowOpen(): boolean;
  /** Old single-press behaviour: put all / close / cancel. */
  legacy(): void;
  open(container: number): void;
  search(target: SearchTarget): void;
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
  /** Open opening menu (hold F at a door / gate / window, or a tap without a main use). */
  private menu:
    { door: DoorTarget; options: OpeningOption[]; sel: number; title?: string } | undefined;

  constructor(private readonly host: InteractHost) {}

  private nearest(): NearbyContainerView | undefined {
    const p = this.host.player();
    return p ? nearestContainer(this.host.state().nearby, p.x, p.y) : undefined;
  }

  private target(): HoldTarget | undefined {
    const p = this.host.player();
    if (!p) return undefined;
    const c = this.nearest();
    const door = this.host.door();
    if (door && doorWins(door, c !== undefined)) return { edge: edgeKey(door) };
    return c ? { container: c.id } : { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  /** The opening menu is open (number keys / F pick an entry, not the quick slots). */
  get menuOpen(): boolean {
    return this.menu !== undefined;
  }

  /** Picks menu entry `i` (0-based); false when no menu / no such entry. */
  choose(i: number): boolean {
    const m = this.menu;
    const o = m?.options[i];
    if (!m || !o) return false;
    this.menu = undefined;
    if (o.disabled) {
      this.host.toast?.(o.disabled);
      return true;
    }
    if (o.cmd === 'furniture') {
      if (o.action) this.host.useEdgeAction?.(m.door, o.action);
      return true;
    }
    if (o.cmd === 'coverWindow' && o.item === undefined) {
      // „Zasłoń…”: second step, which carried item to hang.
      const items = this.host.coverItems?.() ?? [];
      if (!items.length) {
        this.host.toast?.(NO_COVER_TOAST);
        return true;
      }
      this.menu = {
        door: m.door,
        title: COVER_PICK_LABEL,
        sel: 0,
        options: items.map((c) => ({ cmd: 'coverWindow', label: c.label, item: c.id })),
      };
      return true;
    }
    this.host.opening(m.door, o.cmd, o.item);
    return true;
  }

  /** Highlights menu entry `i` (mouse hover). */
  highlight(i: number): void {
    if (this.menu && i >= 0 && i < this.menu.options.length) this.menu.sel = i;
  }

  closeMenu(): void {
    this.menu = undefined;
  }

  /** Menu entries at `door`: the timed actions plus the sim's lock entries. */
  private menuOf(door: DoorTarget) {
    return openingMenu(door, lockOptions(this.host.edgeActions?.(door)));
  }

  /**
   * The container the F key acts on now (its furniture is highlighted, Paweł 25.11): the one
   * being searched, else the nearest world storage in reach unless a door / window wins.
   */
  focus(): NearbyContainerView | undefined {
    const h = this.host;
    const s = h.state();
    if (!h.player() || h.windowOpen() || s.container || this.menu) return undefined;
    if (s.action) {
      const id = s.action.kind === 'search' ? s.action.container : undefined;
      const c = id === undefined ? undefined : s.nearby.find((n) => n.id === id);
      return c?.kind === 'world' ? c : undefined;
    }
    const c = this.nearest();
    if (!c || c.kind !== 'world') return undefined;
    const door = h.door();
    return door && doorWins(door, true) ? undefined : c;
  }

  private openMenu(door: DoorTarget): boolean {
    const options = this.menuOf(door);
    if (!options.length) return false;
    this.menu = { door, options, sel: 0 };
    return true;
  }

  press(now: number): void {
    if (this.menu) {
      this.choose(this.menu.sel);
      return;
    }
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
      // An opening in reach (it wins over a container only when very close): its main use
      // (open / close, climb through), else its menu.
      const box = ev.target && 'container' in ev.target ? ev.target.container : undefined;
      const door = h.door();
      if (door && doorWins(door, box !== undefined)) {
        const main = openingPrimary(door);
        if (main) h.opening(door, main.cmd);
        else this.openMenu(door);
      } else if (box !== undefined) h.open(box);
    } else if (ev.type === 'start') {
      const t = ev.target;
      if ('edge' in t) {
        // Hold at an opening: its action menu; without one, the spot search as before.
        const door = h.door();
        const p = h.player();
        if (door && edgeKey(door) === t.edge && this.openMenu(door)) return;
        if (p) h.search({ x: Math.floor(p.x), y: Math.floor(p.y) });
      } else if ('container' in t) {
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
    if (!p || h.windowOpen() || s.container) {
      this.menu = undefined;
      return { mode: 'hidden' };
    }
    const key = h.key();
    if (this.menu) {
      const door = h.door();
      if (h.interrupted() || s.action || !door || edgeKey(door) !== edgeKey(this.menu.door)) {
        this.menu = undefined;
      } else {
        const dc = doorCentre(door);
        const at = h.project(dc.x, dc.y, door.z, DOOR_ANCHOR_HEIGHT);
        if (!at) return { mode: 'hidden' };
        return {
          mode: 'menu',
          ...at,
          key,
          title: this.menu.title ?? doorVerb(door),
          items: this.menu.options.map((o) => o.label),
          sel: this.menu.sel,
          ...(this.menu.options.some((o) => o.disabled)
            ? {
                disabled: this.menu.options.flatMap((o, i) => (o.disabled ? [i] : [])),
              }
            : {}),
        };
      }
    }
    // Timed opening action (barricade, force …): the search ring at the edge.
    const edgeAction = s.action?.edge ? s.action : undefined;
    const title = edgeAction ? OPENING_ACTION_TITLES[edgeAction.kind] : undefined;
    if (edgeAction?.edge && title) {
      const e = edgeAction.edge;
      const dc = doorCentre(e);
      const at = h.project(dc.x, dc.y, e.z, DOOR_ANCHOR_HEIGHT);
      if (!at) return { mode: 'hidden' };
      return {
        mode: 'search',
        ...at,
        key,
        progress: actionProgress(s, tick) ?? edgeAction.progress ?? 0,
        name: title,
        title,
        seconds: ((edgeAction.endTick - edgeAction.startTick) * h.tickMs) / 1000,
      };
    }
    const action = s.action?.kind === 'search' ? s.action : undefined;
    if (action || (this.hold.searching && !this.menu)) {
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
        // Spec „Przeszukiwanie a zagrożenie”: zombies chasing / near never cancel the search.
        threat: s.threat > 0,
      };
    }
    if (s.action) return { mode: 'hidden' };
    const c = this.nearest();
    const door = h.door();
    if (door && doorWins(door, c !== undefined)) {
      const dc = doorCentre(door);
      const at = h.project(dc.x, dc.y, door.z, DOOR_ANCHOR_HEIGHT);
      if (!at) return { mode: 'hidden' };
      const more = this.menuOf(door).length > 0;
      return {
        mode: 'prompt',
        ...at,
        key,
        search: more,
        label: doorVerb(door),
        ...(more ? { hold: 'Więcej' } : {}),
      };
    }
    if (!c) return { mode: 'hidden' };
    const at = h.project(c.x + 0.5, c.y + 0.5, c.z, ANCHOR_HEIGHT);
    if (!at) return { mode: 'hidden' };
    return { mode: 'prompt', ...at, key, search: needsSearch(c) };
  }
}
