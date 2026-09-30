import '@deadzone/ui/hud.css';
import './hud-layout.css';
import type { SimEvent } from '@deadzone/protocol';
import {
  applyUiScale,
  applyVignetteAt,
  computeUiScale,
  createActionButton,
  createClock,
  createInventorySlot,
  createKeyHints,
  createMinimap,
  createMoodleList,
  createObjectiveCard,
  createStatBars,
  createThreatBanner,
  createToastStack,
  createVignette,
  hintsVisible,
  isBelowMinResolution,
  setHudMotion,
  toastFromSimEvent,
  toggleHints,
  toPolarity,
  type ActionVM,
  type HintsSetting,
  type MinimapVM,
  type Mounted,
  type ActionButtonProps,
  type InventorySlotProps,
} from '@deadzone/ui';
import type { Bindings } from '../input/bindings.js';
import type { GameState } from '../state/game-state.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex } from './content-index.js';
import {
  HOTBAR_SLOTS,
  actionVMs,
  hintItems,
  hotbarItems,
  moodleVMs,
  statsVM,
  vmKey,
} from './hud-model.js';
import { actionKey } from './key-label.js';
import { containerName, itemCountLabel, moodleName } from './labels.js';
import type { MinimapGeometry } from './minimap-data.js';

/** Stats, moodles, minimap and buttons are published at most this often (spec §5: 10 Hz). */
export const HUD_UPDATE_MS = 100;

export interface HudOptions {
  /** Game root (`#app`): vignette, mood attributes and the HUD layer go here. */
  root: HTMLElement;
  bindings: () => Bindings;
  geometry: MinimapGeometry;
  pois?: MinimapVM['pois'];
  /** Interact button clicked (same as the interact key). */
  onInteract: () => void;
  playerId: number;
}

/** Per-frame inputs; the HUD itself throttles to HUD_UPDATE_MS. */
export interface HudFrame {
  now: number;
  state: GameState;
  /** Player on the sim floor plane (x, y = world x, z) and facing (rad). */
  px: number;
  py: number;
  facing: number;
  cameraYaw: number;
  /** Current sim tick incl. the fraction since the last snapshot (action progress). */
  tick: number;
  /** Minute of day for the vignette/chips (lighting minute, incl. the dev `?time` override). */
  minute: number;
  /** Clock shown (sim `view.clock`, or the dev override); undefined = no clock yet. */
  clock: { day: number; minuteOfDay: number } | undefined;
  interactHeld: boolean;
}

export interface Hud {
  frame(f: HudFrame): void;
  events(events: readonly SimEvent[]): void;
  setContent(content: HudContentIndex): void;
  selectSlot(index: number): void;
  /** F1: flips the key-hint row. */
  toggleHints(now: number): void;
  resize(width: number, height: number): void;
}

/** Runs `update` only when the view model's key changes (no DOM writes for equal values). */
function gated<P>(m: Mounted<P>): (vm: P) => void {
  let key: string | undefined;
  return (vm) => {
    const k = vmKey(vm);
    if (k === key) return;
    key = k;
    m.update(vm);
  };
}

/** HUD A (`@deadzone/ui`) as a DOM layer over the canvas, fed from the game state store. */
export function createHud(opts: HudOptions): Hud {
  const { root } = opts;
  let content = EMPTY_HUD_CONTENT;
  const hud = document.createElement('div');
  hud.className = 'dz-hud';
  hud.dataset.objective = 'none';
  root.append(createVignette(), hud);
  setHudMotion(root, 'auto');

  const group = (name: string, ...children: HTMLElement[]): HTMLElement => {
    const g = document.createElement('div');
    g.className = `dz-g dz-g--${name}`;
    g.append(...children);
    hud.append(g);
    return g;
  };

  // TODO(objectives): no objective system in the sim yet → card hidden, moodles at y 32.
  const objective = createObjectiveCard(null);
  group('objective', objective.el);
  const moodles = createMoodleList([], { maxRows: 2 });
  group('moodles', moodles.el);
  const hintsBase = createKeyHints({ items: hintItems(opts.bindings()), visible: true });
  group('hints', hintsBase.el);
  // Threat is always low until zombies exist (Stage 4): banner hidden.
  const threat = createThreatBanner({ level: 'low' });
  group('threat', threat.el);
  const clock = createClock({ day: 1, minuteOfDay: 0 });
  const clockGroup = group('clock', clock.el);
  clockGroup.hidden = true;
  const minimapVM = (f: Pick<HudFrame, 'px' | 'py' | 'facing' | 'cameraYaw'>): MinimapVM => ({
    player: { x: f.px, z: f.py, heading: f.facing },
    cameraYaw: f.cameraYaw,
    roads: opts.geometry.roads,
    buildings: opts.geometry.buildings,
    pois: opts.pois ?? [],
    enemies: [],
  });
  const minimap = createMinimap(minimapVM({ px: 0, py: 0, facing: 0, cameraYaw: 0 }), {
    roadWidth: 1,
  });
  group('minimap', minimap.el);
  const toasts = createToastStack();
  group('toasts', toasts.el);

  let selected = 0;
  const slots = Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
    const slot = createInventorySlot({ item: null, keybind: String(i + 1) });
    return { slot, set: gated(slot), index: i };
  });
  const hotbar = document.createElement('div');
  hotbar.className = 'dz-hotbar dz-glass';
  hotbar.append(...slots.map((s) => s.slot.el));
  group('hotbar', hotbar);
  const stats = createStatBars({ health: 100, thirst: 100, hunger: 100, energy: 100 });
  const setStats = gated(stats);
  group('stats', stats.el);
  const actionsGroup = group('actions');
  const buttons = new Map<
    string,
    { m: Mounted<ActionButtonProps>; set: (p: ActionButtonProps) => void }
  >();

  const lowRes = document.createElement('div');
  lowRes.className = 'dz-g dz-lowres dz-glass';
  lowRes.textContent = 'Zalecana rozdzielczość min. 1280×720';
  lowRes.hidden = true;
  hud.append(lowRes);

  const setMoodles = gated(moodles);
  const setMinimap = (vm: MinimapVM): void => minimap.update(vm);
  const setHints = gated(hintsBase);
  const setClock = gated(clock);
  const since = new Map<string, number>();
  let hintsSetting: HintsSetting = 'auto';
  const bootMs = performance.now();
  let lastUpdate = -Infinity;
  let lastMinute = -1;
  let lastMinimapKey = '';
  let openContainer: number | undefined;
  let lastState: GameState | undefined;

  const syncActions = (vms: ActionVM[], held: boolean): void => {
    const ids = new Set(vms.map((v) => v.id));
    for (const [id, b] of buttons) {
      if (!ids.has(id)) {
        b.m.destroy();
        buttons.delete(id);
      }
    }
    for (const vm of vms) {
      const props: ActionButtonProps = {
        label: vm.label,
        icon: vm.icon,
        key: vm.key,
        variant: vm.variant,
        enabled: vm.enabled,
        ...(vm.progress !== undefined ? { progress: vm.progress } : {}),
        ...(held && vm.enabled ? { forced: 'pressed' as const } : {}),
        onActivate: opts.onInteract,
      };
      let b = buttons.get(vm.id);
      if (!b) {
        const m = createActionButton(props);
        actionsGroup.append(m.el);
        b = { m, set: gated(m) };
        buttons.set(vm.id, b);
      }
      b.set(props);
    }
  };

  const moodleInfo = (id: string) => {
    const def = content.moodles.get(id);
    return def ? { label: moodleName(id), polarity: toPolarity(def.polarity) } : undefined;
  };

  return {
    frame(f) {
      // Minute-level work (vignette, clock) and container toasts follow the state directly.
      const minute = Math.floor(f.minute);
      if (minute !== lastMinute) {
        lastMinute = minute;
        applyVignetteAt(root, minute);
      }
      if (f.clock) {
        clockGroup.hidden = false;
        setClock({ day: f.clock.day, minuteOfDay: Math.floor(f.clock.minuteOfDay) });
      }
      const s = f.state;
      if (s.container?.id !== openContainer) {
        openContainer = s.container?.id;
        if (s.container) {
          toasts.push({
            kind: 'info',
            text: `${containerName(s.container.type, s.container.kind)}: ${itemCountLabel(s.container.items.length)}`,
          });
        }
      }
      if (f.now - lastUpdate < HUD_UPDATE_MS) return;
      lastUpdate = f.now;
      if (s !== lastState) {
        lastState = s;
        setStats(statsVM(s));
        setMoodles(moodleVMs(s.player.moodles, content, since, f.now));
        const items = hotbarItems(s, content);
        for (const slot of slots) {
          const p: InventorySlotProps = {
            item: items[slot.index] ?? null,
            keybind: String(slot.index + 1),
            selected: slot.index === selected,
            onSelect: () => this.selectSlot(slot.index),
          };
          slot.set(p);
        }
      }
      const key = actionKey(opts.bindings(), 'interact');
      syncActions(actionVMs(s, f.px, f.py, key, f.tick), f.interactHeld);
      const mm = minimapVM(f);
      const mmKey = `${mm.player.x.toFixed(1)},${mm.player.z.toFixed(1)},${mm.player.heading.toFixed(2)},${mm.cameraYaw.toFixed(2)}`;
      if (mmKey !== lastMinimapKey) {
        lastMinimapKey = mmKey;
        setMinimap(mm);
      }
      setHints({
        items: hintItems(opts.bindings()),
        visible: hintsVisible(hintsSetting, f.now - bootMs),
      });
    },
    events(events) {
      for (const e of events) {
        const t = toastFromSimEvent(e, { playerId: opts.playerId, moodle: moodleInfo });
        if (t) toasts.push(t);
        else if (e.type === 'actionInterrupted' && e.playerId === opts.playerId) {
          toasts.push({ kind: 'warning', text: 'Przerwano akcję' });
        }
      }
    },
    setContent(next) {
      content = next;
      lastState = undefined;
    },
    selectSlot(index) {
      selected = Math.min(HOTBAR_SLOTS - 1, Math.max(0, index));
      lastState = undefined;
      lastUpdate = -Infinity;
    },
    toggleHints(now) {
      hintsSetting = toggleHints(hintsSetting, now - bootMs);
      lastUpdate = -Infinity;
    },
    resize(width, height) {
      applyUiScale(hud, computeUiScale(width, height));
      lowRes.hidden = !isBelowMinResolution(width, height);
    },
  };
}
