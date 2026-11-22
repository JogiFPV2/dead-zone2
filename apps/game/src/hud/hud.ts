import '@deadzone/ui/hud.css';
import './hud-layout.css';
import './hud-v2.css';
import './hud-v3.css';
import './layout/hud-slots.css';
import type { SimEvent } from '@deadzone/protocol';
import type { HudLayoutSlot } from '@deadzone/ui/settings';
import {
  applyUiScale,
  applyVignetteAt,
  computeUiScale,
  createActionButton,
  createInventorySlot,
  createKeyHints,
  createMinimap,
  MINIMAP_PX_PER_M,
  createMoodleList,
  createObjectiveCard,
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
import type { CommandBody } from '../sim/sim-client.js';
import type { GameState } from '../state/game-state.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex } from './content-index.js';
import {
  HOTBAR_SLOTS,
  hintItems,
  hotbarCommand,
  hotbarHeldIndex,
  hotbarItems,
  moodleVMs,
  statsVM,
  threatLevel,
  vmKey,
} from './hud-model.js';
import { actionKey } from './key-label.js';
import { craftItemName } from './crafting-labels.js';
import { containerName, itemCountLabel, moodleName } from './labels.js';
import type { MinimapGeometry } from './minimap-data.js';
import { dockSide, firearmVM, noiseRingRadius, type FirearmVM } from './firearm-model.js';
import { createFirearmWidget } from './firearm-widget.js';
import { itemImage } from './item-icons.js';
import { meleeVM, WEAPON_BROKE_MS } from './melee-model.js';
import { createMeleeWidget } from './melee-widget.js';
import { createTargetCard } from './target-card.js';
import { targetCardVM } from './target-card-model.js';
import { leisureActionVMs } from './leisure-actions.js';
import type { LeisureSpot } from './leisure-spots.js';
import type { Feedback } from './sleep-feedback.js';
import { createSleepNotice } from './sleep-notice.js';
import { createMinimapZoomControls } from './minimap-zoom-controls.js';
import { createFloorHud, type FloorHudVM } from './floor-hud.js';
import { DEFAULT_SLEEP_SETTINGS } from './sleep-settings.js';
import { createHud2Parts } from './v2/hud2.js';
import type { PromptVM } from './v2/interact-prompt.js';
import type { QuickAccessId } from './v2/quick-access.js';
import { createHpBar } from './v3/hp-bar.js';
import { createStealthEye } from './v3/stealth-eye.js';
import {
  AMMO_SHOW_MS,
  MAX_STATUS_CHIPS,
  createShowTimer,
  problemMoodles,
  withSneakChip,
} from './v3/hud3-model.js';
import { scaledUi } from '../ui/ui-scale.js';

/** The Ø136 minimap (HUD v3) draws the Ø200 SVG scaled down; zoom keeps 2.5 px/m at 1,0×. */
const MINIMAP_FIT = 200 / 136;

/** Stats, moodles, minimap and buttons are published at most this often (spec §5: 10 Hz). */
export const HUD_UPDATE_MS = 100;

export interface HudOptions {
  /** Game root (`#app`): vignette, mood attributes and the HUD layer go here. */
  root: HTMLElement;
  bindings: () => Bindings;
  /** Minimap layers; a function = re-read every frame (generated maps: follows the player). */
  geometry: MinimapGeometry | (() => MinimapGeometry);
  pois?: MinimapVM['pois'];
  /** Toast for the local player's door / window commands (rejections, `doorForced`). */
  openingToast?: (e: SimEvent) => string | undefined;
  /** Interact button clicked (same as the interact key). */
  onInteract: () => void;
  /** Other contextual buttons (`sleep`, `watchTv`) clicked. */
  onAction: (id: string) => void;
  /** Beds, sofas and TVs of the map (sleep / TV buttons). */
  spots: () => readonly LeisureSpot[];
  /** Sleep / leisure feedback for an event; undefined = the default toast mapping. */
  feedback: (e: SimEvent) => Feedback | undefined;
  /** Hotbar slot → sim command (weapon into / out of the right hand). */
  send: (cmd: CommandBody) => void;
  playerId: number;
  /** Sim tick length (reload seconds left). */
  tickMs: number;
  /** Minimap zoom (steps in minimap-zoom.ts) and its change (persist). */
  minimapZoom?: number;
  onMinimapZoom?: (zoom: number) => void;
  /** Minimap zoom steps and level label (touch: 4 radius levels, minimap-levels.ts). */
  minimapSteps?: readonly number[];
  minimapLabel?: (zoom: number) => string;
  /** Top bar quick access clicked (HUD v2). */
  onQuickAccess: (id: QuickAccessId) => void;
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
  /** RMB aim with a firearm (minimap noise ring). */
  aiming: boolean;
  /** Camera zoom target (HUD v2 chip). */
  cameraZoom: number;
  /** Sneak toggle on (`CharacterView.sneaking`): „Skradanie” status chip. */
  sneaking?: boolean;
}

export interface Hud {
  frame(f: HudFrame): void;
  events(events: readonly SimEvent[]): void;
  setContent(content: HudContentIndex): void;
  selectSlot(index: number): void;
  /** F1: flips the key-hint row. */
  toggleHints(now: number): void;
  resize(width: number, height: number): void;
  /** Firearm in hand: the widget's view model (aim reticle, input), else undefined. */
  firearm(): FirearmVM | undefined;
  /** LMB on an empty gun: widget shake. */
  dryFire(): void;
  /** Interaction prompt / search ring at the object (HUD v2 §6). */
  setPrompt(vm: PromptVM): void;
  /** Opening menu entry clicked / hovered. */
  onPromptMenu(fn: (i: number, kind: 'pick' | 'hover') => void): void;
  /** Info toast (e.g. „wkrótce” for screens that do not exist yet). */
  toast(text: string): void;
  /** Floor badge, level-change toast and the floor plan on the minimap („Piętra (UI)”). */
  setFloor(vm: FloorHudVM): void;
  /** HUD editor: the DOM element(s) each layout slot moves (`weapon` without the car panel). */
  layoutTargets(): Partial<Record<HudLayoutSlot, HTMLElement[]>>;
  /**
   * HUD editor: elements hidden in calm play (item log, weapon panel, threat, key hints) show
   * sample content so they can be placed; off = back to the game state on the next frame.
   */
  setEditPreview(on: boolean): void;
}

/** HUD editor sample of the weapon panel (hud-editor.png: Pistolet M9, 12/15, zapas 34). */
const SAMPLE_FIREARM: FirearmVM = {
  weapon: 'base:pistol',
  name: 'Pistolet M9',
  state: 'normal',
  title: '',
  loaded: 12,
  capacity: 15,
  reserve: 34,
  reserveMags: 0,
  ammo: '9 mm',
  pips: 'bars',
  noiseRadius: 0,
  rangeTiles: 0,
};

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

  // HUD editor slot `status` (accepted mockup hud-editor.png): objective, status chips and the
  // HP bar as one block that moves and scales together (HP under the statuses).
  const statusGroup = group('status');
  const inStatus = (name: string, el: HTMLElement): void => {
    statusGroup.append(group(name, el));
  };
  // TODO(objectives): no objective system in the sim yet → card hidden, moodles at y 32.
  const objective = createObjectiveCard(null);
  inStatus('objective', objective.el);
  const moodles = createMoodleList([], { maxRows: 1, maxVisible: MAX_STATUS_CHIPS });
  inStatus('moodles', moodles.el);
  const hintsBase = createKeyHints({ items: hintItems(opts.bindings()), visible: true });
  const hintsGroup = group('hints', hintsBase.el);
  // Sim threat 0–100 → banner level (low hides it).
  const threat = createThreatBanner({ level: 'low' });
  const setThreat = gated(threat);
  const threatGroup = group('threat', threat.el);
  const geometry = opts.geometry;
  const geo = typeof geometry === 'function' ? geometry : () => geometry;
  const minimapVM = (f: Pick<HudFrame, 'px' | 'py' | 'facing' | 'cameraYaw'>): MinimapVM => ({
    player: { x: f.px, z: f.py, heading: f.facing },
    cameraYaw: f.cameraYaw,
    roads: geo().roads,
    buildings: geo().buildings,
    pois: opts.pois ?? [],
    enemies: [],
  });
  const minimap = createMinimap(minimapVM({ px: 0, py: 0, facing: 0, cameraYaw: 0 }), {
    roadWidth: 1,
    zoom: (opts.minimapZoom ?? 1) * MINIMAP_FIT,
  });
  const minimapGroup = group('minimap', minimap.el);
  const minimapZoom = createMinimapZoomControls(minimap.el, opts.minimapZoom ?? 1, {
    apply: (z) => minimap.setZoom(z * MINIMAP_FIT),
    change: (z) => opts.onMinimapZoom?.(z),
    ...(opts.minimapSteps ? { steps: opts.minimapSteps } : {}),
    ...(opts.minimapLabel ? { label: opts.minimapLabel } : {}),
  });
  minimapGroup.append(minimapZoom.el);
  // Shot noise radius while aiming a firearm (spec §4): dashed ring around the player.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const noiseRing = document.createElementNS(SVG_NS, 'svg');
  noiseRing.setAttribute('class', 'dz-noise-ring');
  noiseRing.setAttribute('viewBox', '0 0 200 200');
  const noiseCircle = document.createElementNS(SVG_NS, 'circle');
  noiseCircle.setAttribute('cx', '100');
  noiseCircle.setAttribute('cy', '100');
  noiseRing.append(noiseCircle);
  noiseRing.setAttribute('hidden', '');
  minimapGroup.append(noiseRing);
  // Floors: badge at the minimap's left edge (moves with `minimap` in the HUD editor), plan of
  // the current floor inside the minimap's world layer, toast at the top centre.
  const floors = createFloorHud(minimap.el.querySelector('.dz-minimap__world'));
  minimapGroup.append(floors.badge);
  const toasts = createToastStack();
  group('toasts', toasts.el);
  group('floortoast', floors.toast);
  const v2 = createHud2Parts({
    root,
    group,
    bindings: opts.bindings,
    content: () => content,
    onQuickAccess: opts.onQuickAccess,
    playerId: opts.playerId,
  });
  const notice = createSleepNotice(root);

  let selected = 0;
  const slots = Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
    const slot = createInventorySlot({ item: null, keybind: String(i + 1) });
    return { slot, set: gated(slot), index: i };
  });
  const hotbar = document.createElement('div');
  hotbar.className = 'dz-hotbar dz-glass';
  hotbar.append(...slots.map((s) => s.slot.el));
  const hotbarGroup = group('hotbar', hotbar);
  const firearmWidget = createFirearmWidget();
  // Own group (HUD editor slot `weapon`, shared with the car panel): right 18, bottom 73.
  // Held non-firearm item (improvised / default / catalogue melee): same slot, never calm-hidden.
  const meleeWidget = createMeleeWidget();
  const weaponGroup = group('weapon', firearmWidget.el, meleeWidget.el);
  let firearm: FirearmVM | undefined;
  const slotBar = document.createElement('div');
  slotBar.className = 'dz-fw-slotbar';
  const slotBarFill = document.createElement('i');
  slotBar.append(slotBarFill);
  // HUD v3: thin HP bar only; thirst / hunger / energy show as statuses when they are a problem.
  const hp = createHpBar();
  inStatus('hp', hp.el);
  const eye = createStealthEye();
  inStatus('stealth', eye.el);
  // Target card (sim `view.target`, protocol 20) under the HP bar, in the same status block.
  const targetCard = createTargetCard();
  inStatus('target', targetCard.el);
  const ammoShown = createShowTimer(AMMO_SHOW_MS);
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
  const since = new Map<string, number>();
  // HUD v3: no key-hint row by default (the top bar lists the screens); F1 shows it.
  let hintsSetting: HintsSetting = 'off';
  const bootMs = performance.now();
  let lastUpdate = -Infinity;
  let lastMinute = -1;
  let lastMinimapKey = '';
  let openContainer: number | undefined;
  let lastState: GameState | undefined;
  let lastSneaking = false;
  /** Newest frame state (hotbar commands). */
  let current: GameState | undefined;

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
        onActivate: vm.id === 'interact' ? opts.onInteract : () => opts.onAction(vm.id),
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

  /** 3 px ammo bar in the hotbar slot that holds the gun in hand. */
  const syncSlotBar = (s: GameState): void => {
    const held = s.inventory?.equipped.hand_primary;
    const items = held !== undefined && firearm ? hotbarItems(s, content) : [];
    const i = items.findIndex((it) => it?.id === String(held));
    if (!firearm || i < 0) {
      slotBar.remove();
      return;
    }
    const el = slots[i]!.slot.el;
    if (slotBar.parentElement !== el) el.append(slotBar);
    slotBar.dataset.state = firearm.state;
    const p =
      firearm.state === 'reloading'
        ? (firearm.progress ?? 0)
        : firearm.loaded / Math.max(1, firearm.capacity);
    slotBarFill.style.width = `${(Math.min(1, p) * 100).toFixed(1)}%`;
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
      const s = f.state;
      current = s;
      // Firearm widget, slot mini-bar and the minimap noise ring follow every frame (animation).
      const b = opts.bindings();
      firearm = firearmVM(s, content, f.tick, opts.tickMs, {
        reload: actionKey(b, 'reload'),
        attack: actionKey(b, 'primaryAction'),
        inventory: actionKey(b, 'inventory'),
      });
      firearmWidget.update(firearm, dockSide(selected));
      meleeWidget.update(
        firearm
          ? undefined
          : meleeVM(s.combat, craftItemName, (id) => content.items.get(id)?.meleeCategory),
        f.now,
      );
      // HUD v3: the ammo widget only after a change (draw, shot, reload) and while aiming.
      const ammoKey = firearm
        ? `${firearm.weapon}|${firearm.state}|${firearm.loaded}|${firearm.reserve}|${firearm.reserveMags}`
        : '';
      const ammoBusy = f.aiming || firearm?.state === 'reloading' || firearm?.state === 'shell';
      // Called every frame (also without a gun) so drawing the gun counts as a change.
      const ammoOn = ammoShown(ammoKey, f.now, ammoBusy);
      const ammo = firearm ? (ammoOn ? 'show' : 'calm') : 'none';
      if (hud.dataset.ammo !== ammo) hud.dataset.ammo = ammo;
      syncSlotBar(s);
      if (firearm && f.aiming) {
        noiseRing.removeAttribute('hidden');
        noiseCircle.setAttribute(
          'r',
          noiseRingRadius(
            firearm.noiseRadius,
            MINIMAP_PX_PER_M * minimapZoom.get() * MINIMAP_FIT,
          ).toFixed(1),
        );
      } else noiseRing.setAttribute('hidden', '');
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
      v2.frame({ now: f.now, state: s, clock: f.clock, cameraZoom: f.cameraZoom });
      const sneaking = f.sneaking === true;
      if (s !== lastState || sneaking !== lastSneaking) {
        lastState = s;
        lastSneaking = sneaking;
        // The highlight follows the item in hand (inventory PPM / hotbar alike).
        selected = hotbarHeldIndex(s) ?? selected;
        hp.update(statsVM(s).health);
        eye.update({
          level: s.player.alive ? s.stealth?.level : undefined,
          visibility: s.stealth?.visibility ?? 1,
        });
        targetCard.update(targetCardVM(s.target));
        setThreat({ level: threatLevel(s.threat) });
        setMoodles(
          withSneakChip(
            problemMoodles(moodleVMs(s.player.moodles, content, since, f.now), f.now),
            sneaking,
          ),
        );
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
      const leisure = leisureActionVMs(
        s,
        opts.spots(),
        f.px,
        f.py,
        { sleep: actionKey(b, 'sleep'), tv: actionKey(b, 'watchTv') },
        content.sleep ?? DEFAULT_SLEEP_SETTINGS,
        f.tick,
      );
      // HUD v3: F / search live in the prompt at the object; only sleep / TV stay as buttons.
      syncActions(leisure, f.interactHeld);
      const mm = minimapVM(f);
      const mmKey = `${mm.player.x.toFixed(1)},${mm.player.z.toFixed(1)},${mm.player.heading.toFixed(2)},${mm.cameraYaw.toFixed(2)}`;
      if (mmKey !== lastMinimapKey) {
        lastMinimapKey = mmKey;
        setMinimap(mm);
      }
      setHints({
        items: hintItems(opts.bindings(), firearm !== undefined),
        visible: hintsVisible(hintsSetting, f.now - bootMs),
      });
    },
    events(events) {
      v2.events(events, performance.now());
      for (const e of events) {
        if (e.type === 'shot' && e.playerId === opts.playerId) {
          noiseRing.classList.remove('dz-noise-ring--flash');
          void noiseRing.getBoundingClientRect();
          noiseRing.classList.add('dz-noise-ring--flash');
        }
        const fb = opts.feedback(e);
        if (fb) {
          if (fb.toast) toasts.push(fb.toast);
          if (fb.notice) notice.show(fb.notice);
          continue;
        }
        const t = toastFromSimEvent(e, { playerId: opts.playerId, moodle: moodleInfo });
        if (t) toasts.push(t);
        else if (e.type === 'actionInterrupted' && e.playerId === opts.playerId) {
          toasts.push({ kind: 'warning', text: 'Przerwano akcję' });
        } else if (e.type === 'weaponBroke' && e.playerId === opts.playerId) {
          toasts.push({ kind: 'damage', text: `Złamane: ${craftItemName(e.itemId)}` });
          const now = performance.now();
          meleeWidget.broke(e.itemId, now);
          // The slot that held it: the item's icon greys out and shakes for 0.6 s, also when the
          // last piece is gone and the slot is already empty.
          const slotEl = slots[selected]?.slot.el;
          const img = itemImage(e.itemId);
          if (slotEl && img) {
            const ghost = document.createElement('img');
            ghost.className = 'dz-slot__broke';
            ghost.src = img;
            ghost.alt = '';
            slotEl.dataset.broke = '';
            slotEl.append(ghost);
            setTimeout(() => {
              ghost.remove();
              delete slotEl.dataset.broke;
            }, WEAPON_BROKE_MS);
          }
        } else if (e.type === 'zombieKilled' && e.playerId === opts.playerId) {
          toasts.push({ kind: 'info', text: 'Zabity zombie' });
        } else {
          const text = opts.openingToast?.(e);
          if (text) toasts.push({ kind: 'warning', text });
        }
      }
    },
    setContent(next) {
      content = next;
      lastState = undefined;
    },
    selectSlot(index) {
      selected = Math.min(HOTBAR_SLOTS - 1, Math.max(0, index));
      const cmd = current ? hotbarCommand(current, content, selected) : undefined;
      if (cmd) opts.send(cmd);
      lastState = undefined;
      lastUpdate = -Infinity;
    },
    toggleHints(now) {
      hintsSetting = toggleHints(hintsSetting, now - bootMs);
      lastUpdate = -Infinity;
    },
    firearm: () => firearm,
    dryFire: () => firearmWidget.dryFire(),
    setPrompt: (vm) => v2.setPrompt(vm),
    onPromptMenu: (fn) => v2.onPromptMenu(fn),
    toast: (text) => toasts.push({ kind: 'info', text }),
    // CSS px per metre on the Ø136 minimap (dot sizes of the mockup are in CSS px).
    setFloor: (vm) =>
      floors.update(vm, performance.now(), MINIMAP_PX_PER_M * minimapZoom.get() * MINIMAP_FIT),
    layoutTargets: () => ({
      topbar: [v2.topbar],
      status: [statusGroup],
      minimap: [minimapGroup],
      itemlog: [v2.itemlogGroup],
      weapon: [weaponGroup],
      hotbar: [hotbarGroup],
      threat: [threatGroup],
      hints: [hintsGroup],
    }),
    setEditPreview(on) {
      hud.toggleAttribute('data-hud-edit', on);
      floors.setEditPreview(on);
      v2.setEditPreview(on, performance.now());
      if (on) {
        threat.update({ level: 'medium' });
        firearmWidget.update(SAMPLE_FIREARM, 'right');
        hud.dataset.ammo = 'show';
        hintsBase.update({ items: hintItems(opts.bindings(), false), visible: true });
      } else {
        lastState = undefined;
        lastUpdate = -Infinity;
      }
    },
    resize(width, height) {
      applyUiScale(hud, scaledUi(computeUiScale(width, height)));
      v2.resize(width, height);
      lowRes.hidden = !isBelowMinResolution(width, height);
    },
  };
}
