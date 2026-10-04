import type { Bindings } from '../../input/bindings.js';
import type { GameState } from '../../state/game-state.js';
import type { HudContentIndex } from '../content-index.js';
import { craftItemName } from '../crafting-labels.js';
import { itemIcon } from '../hud-model.js';
import { actionKey, keyboardKey } from '../key-label.js';
import { zoomLabel } from '../minimap-zoom.js';
import { createInteractPrompt, type PromptVM } from './interact-prompt.js';
import { itemLogChanges, type ItemLogEvent } from './item-log-model.js';
import { createItemLog } from './item-log.js';
import {
  QUICK_ACCESS,
  activeQuickAccess,
  skillLevelSum,
  type QuickAccessId,
} from './quick-access.js';
import { hud2Scale } from './scale.js';
import { createTopBar } from './top-bar.js';
import { CAMERA_CHIP_MS, createShowTimer } from '../v3/hud3-model.js';
import { uiScale } from '../../ui/ui-scale.js';

export interface Hud2Options {
  root: HTMLElement;
  group: (name: string, ...children: HTMLElement[]) => HTMLElement;
  bindings: () => Bindings;
  content: () => HudContentIndex;
  onQuickAccess: (id: QuickAccessId) => void;
  playerId: number;
}

export interface Hud2Frame {
  now: number;
  state: GameState;
  clock: { day: number; minuteOfDay: number } | undefined;
  /** Camera zoom target (chip `KAMERA 1,0×`). */
  cameraZoom: number;
}

export interface Hud2Parts {
  /** At the HUD rate (10 Hz). */
  frame(f: Hud2Frame): void;
  setPrompt(vm: PromptVM): void;
  /** Opening menu entry clicked / hovered. */
  onPromptMenu(fn: (i: number, kind: 'pick' | 'hover') => void): void;
  /** Sim events: item log (`itemPicked` / `itemDropped` / `spotSearched`). */
  events(events: readonly ItemLogEvent[], now: number): void;
  resize(width: number, height: number): void;
}

/**
 * HUD v2 additions (deadzone-hud-v2-spec): top bar with date/time and quick access, item log,
 * interaction prompt / search ring and the camera zoom chip.
 */
export function createHud2Parts(opts: Hud2Options): Hud2Parts {
  let skillsSeen: number | undefined;
  const top = createTopBar((id) => {
    if (id === 'skills') top.setNotify('skills', false);
    opts.onQuickAccess(id);
  });
  opts.root.append(top.el);

  const log = createItemLog({
    name: craftItemName,
    vectorIcon: (def) => itemIcon(opts.content().items.get(def)) || 'tag',
  });
  opts.group('itemlog', log.el);

  const prompt = createInteractPrompt();
  opts.group('world', prompt.el);

  const chip = document.createElement('div');
  chip.className = 'dz-camchip dz-glass';
  const chipLabel = document.createElement('span');
  chipLabel.className = 'dz-camchip__label';
  chipLabel.textContent = 'KAMERA';
  const chipValue = document.createElement('span');
  chipValue.className = 'dz-camchip__value';
  const chipKeys = document.createElement('span');
  chipKeys.className = 'dz-key';
  chip.append(chipLabel, chipValue, chipKeys);
  const chipGroup = opts.group('camera', chip);
  // HUD v3: the chip shows only for a moment after the camera zoom changes.
  const chipShown = createShowTimer(CAMERA_CHIP_MS);

  return {
    frame(f) {
      const s = f.state;
      top.setClock(f.clock);
      const b = opts.bindings();
      const keys = {} as Record<QuickAccessId, string>;
      for (const q of QUICK_ACCESS) keys[q.id] = actionKey(b, q.action);
      top.setKeys(keys);
      top.setActive(activeQuickAccess(opts.root.dataset.modal));
      const skills = skillLevelSum(s.skills);
      if (skillsSeen !== undefined && skills > skillsSeen) top.setNotify('skills', true);
      skillsSeen = skills;
      log.frame(f.now);
      chipValue.textContent = zoomLabel(f.cameraZoom);
      chipGroup.toggleAttribute('data-show', chipShown(chipValue.textContent, f.now));
      chipKeys.textContent = `${keyboardKey(b, 'zoomOut')} ${keyboardKey(b, 'zoomIn')}`;
    },
    setPrompt: (vm) => prompt.update(vm),
    onPromptMenu: (fn) => {
      prompt.onMenu = fn;
    },
    events: (events, now) => log.push(itemLogChanges(events, opts.playerId), now),
    resize(width, height) {
      opts.root.style.setProperty('--hud2-s', String(hud2Scale(width, height, uiScale())));
    },
  };
}
