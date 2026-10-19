import './furniture.css';
import type { ContainerView, SimEvent } from '@deadzone/protocol';
import type { CommandBody } from '../../sim/sim-client.js';
import type { GameState } from '../../state/game-state.js';
import type { HudContentIndex } from '../content-index.js';
import { isOutsideClick } from '../outside-click.js';
import { DEFAULT_SLEEP_SETTINGS, type SleepSurface } from '../sleep-settings.js';
import type { FurnitureSource, FurnitureView } from './furniture-api.js';
import {
  DIALOG_ACTIONS,
  furnitureMenuVM,
  fridgeVM,
  sleepChoiceVM,
  stepSelection,
  watchVM,
  type FurnMenuVM,
  type FurnSubRowVM,
} from './furniture-model.js';
import { DEFAULT_ALARM, alarmOptions } from './sleep-alarm.js';
import { fridgeHtml, menuHtml, sleepHtml, subHtml, watchHtml } from './furniture-views.js';

/** Menu refresh (enabled / reasons follow the sim) and panel refresh. */
const REFRESH_MS = 200;
/** The menu closes when the player walks this far from where it opened (tiles). */
const CLOSE_WALK_TILES = 2;
/** Menu size used to keep it on screen (px at scale 1). */
const MENU_W = 330;
const MENU_H = 240;

export interface FurnitureUiOptions {
  root: HTMLElement;
  source: FurnitureSource;
  state: () => GameState;
  content: () => HudContentIndex;
  player: () => { x: number; y: number; z: number } | undefined;
  send: (cmd: CommandBody) => void;
  /** Key labels: run (interact, F), close (Esc). */
  keys: () => { run: string; close: string };
  /** True when `code` is bound to `interact` (runs the selected row). */
  isRunKey: (code: string) => boolean;
  /** Where sleeping would happen now and which surfaces are within 1.5 tiles. */
  surfaces: () => { here: SleepSurface; nearby: ReadonlySet<SleepSurface> };
  tickMs: number;
}

interface MenuState {
  view: FurnitureView;
  vm: FurnMenuVM;
  x: number;
  y: number;
  sel: number;
  /** Player position when it opened. */
  from: { x: number; y: number };
  sub?: { sel: number } | undefined;
}

/**
 * Furniture UI (spec „Meble i czynności (UI)”): the RMB context menu over any object the sim
 * offers actions for, the VHS submenu, the fridge window, the watching panel and the sleep
 * choice. Generic over `typeId`; sim-less features are hidden (`FURNITURE_FEATURES`).
 */
export class FurnitureUi {
  private readonly layer: HTMLDivElement;
  private readonly menuEl: HTMLDivElement;
  private readonly subEl: HTMLDivElement;
  private readonly fridgeEl: HTMLDivElement;
  private readonly watchEl: HTMLDivElement;
  private readonly sleepEl: HTMLDivElement;
  private menu: MenuState | undefined;
  private sleep: { view: FurnitureView; alarm: string } | undefined;
  private fridgeId: number | undefined;
  private fridgeKey = '';
  /** Closed here; the sim's `closeContainer` lands a few ticks later. */
  private dismissed: number | undefined;
  private sleepKey = '';
  private watchKey = '';
  private lastRefresh = -Infinity;
  /** Tapes this character watched to the end this session (`vhsWatched`; sim has no list yet). */
  private readonly watched = new Set<string>();
  private justClosedAt = -Infinity;

  constructor(private readonly opts: FurnitureUiOptions) {
    const div = (cls: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.className = cls;
      d.hidden = true;
      return d;
    };
    this.layer = document.createElement('div');
    this.layer.className = 'dz-fm-layer';
    this.menuEl = div('dz-fm');
    this.menuEl.setAttribute('role', 'menu');
    this.subEl = div('dz-fm dz-fm--sub');
    this.subEl.setAttribute('role', 'menu');
    this.fridgeEl = div('dz-ff');
    this.fridgeEl.setAttribute('role', 'dialog');
    this.watchEl = div('dz-ftv');
    this.sleepEl = div('dz-fs');
    this.sleepEl.setAttribute('role', 'dialog');
    this.layer.append(this.watchEl, this.fridgeEl, this.sleepEl, this.menuEl, this.subEl);
    opts.root.append(this.layer);

    this.menuEl.addEventListener('pointermove', (e) => {
      const i = rowIndex(e.target);
      if (this.menu && i !== undefined && this.menu.vm.rows[i]?.enabled && this.menu.sel !== i) {
        this.menu.sel = i;
        this.menu.sub = undefined;
        this.render();
      }
    });
    this.menuEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const i = rowIndex(e.target);
      if (!this.menu || i === undefined || !this.menu.vm.rows[i]?.enabled) return;
      this.menu.sel = i;
      this.run();
    });
    this.subEl.addEventListener('pointermove', (e) => {
      const i = rowIndex(e.target);
      if (
        this.menu?.sub &&
        i !== undefined &&
        this.menu.sub.sel !== i &&
        this.subRows()[i]?.enabled
      ) {
        this.menu.sub.sel = i;
        this.render();
      }
    });
    this.subEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const i = rowIndex(e.target);
      if (!this.menu?.sub || i === undefined) return;
      this.menu.sub.sel = i;
      this.runSub();
    });
    this.fridgeEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'close') this.closeFridge();
      else if (act === 'take') this.takeAllFridge();
      else if (act === 'trash') this.trashRotten();
      const row = t.closest<HTMLElement>('.dz-ff__row');
      const c = this.fridgeContainer();
      if (row && c) {
        const it = c.items.find((x) => String(x.id) === row.dataset.id);
        if (it) opts.send({ type: 'takeItem', container: c.id, item: it.id, count: it.count });
      }
    });
    this.watchEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('[data-act="stop"]')) this.stopWatching();
    });
    this.sleepEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const alarm = (e.target as HTMLElement).closest<HTMLElement>('[data-alarm]')?.dataset.alarm;
      if (alarm && this.sleep) {
        this.sleep.alarm = alarm;
        this.renderSleep();
        return;
      }
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'sleep') this.confirmSleep();
      else if (act === 'cancel') this.closeSleep();
    });
    // A press anywhere else closes the menu (and is not an attack: see `swallowsClick`).
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.menu) return;
        if (!isOutsideClick(e.target, '.dz-fm')) return;
        this.closeMenu();
        // LMB only: an RMB press may open the menu of another object right away.
        if (e.button === 0) this.justClosedAt = performance.now();
      },
      true,
    );
    for (const el of [this.menuEl, this.subEl, this.fridgeEl, this.watchEl, this.sleepEl])
      el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Menu, sleep choice or fridge window open (game input waits). */
  get open(): boolean {
    return !!this.menu || !!this.sleep || this.fridgeOpen;
  }

  get menuOpen(): boolean {
    return !!this.menu;
  }

  get fridgeOpen(): boolean {
    return this.fridgeId !== undefined;
  }

  get watching(): boolean {
    return this.opts.state().action?.kind === 'watch';
  }

  /** The loot window leaves fridges to this window. */
  handlesContainer(c: Pick<ContainerView, 'type'> | undefined): boolean {
    return !!c?.type && FRIDGE_TYPE.test(c.type);
  }

  /** A world press that only closed the menu: not an attack / shove. */
  swallowsClick(now = performance.now()): boolean {
    return now - this.justClosedAt < 120;
  }

  /**
   * RMB click over the world at sim point (`x`, `y`, `z`), screen px (`sx`, `sy`): opens the menu
   * when the sim offers actions there. False = nothing there (the caller shoves as before).
   */
  openAt(x: number, y: number, z: number, sx: number, sy: number): boolean {
    const view = this.opts.source.at(x, y, z);
    if (!view) return false;
    const vm = this.vm(view);
    if (!vm.rows.length) return false;
    const p = this.opts.player();
    this.closeSleep();
    const w = this.opts.root.clientWidth;
    const h = this.opts.root.clientHeight;
    this.menu = {
      view,
      vm,
      x: Math.max(8, Math.min(sx + 12, w - MENU_W - 8)),
      y: Math.max(8, Math.min(sy - 12, h - MENU_H - 8)),
      sel: stepSelection(vm.rows, -1, 1),
      from: p ? { x: p.x, y: p.y } : { x, y },
    };
    this.render();
    return true;
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu = undefined;
    this.menuEl.hidden = true;
    this.subEl.hidden = true;
  }

  /** Esc: submenu, menu, sleep choice, fridge — the topmost first. */
  close(): void {
    if (this.menu?.sub) {
      this.menu.sub = undefined;
      this.render();
    } else if (this.menu) this.closeMenu();
    else if (this.sleep) this.closeSleep();
    else if (this.fridgeOpen) this.closeFridge();
  }

  /** Esc while watching (no window open): stop (XP is lost). */
  stopWatching(): void {
    if (this.watching) this.opts.send({ type: 'cancelAction' });
  }

  /** Keyboard while the menu / windows are open; true = consumed. */
  key(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return false;
    if (this.menu) {
      const m = this.menu;
      if (m.sub) {
        const kids = this.subRows();
        if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
          const i = stepSelection(kids, m.sub.sel, e.code === 'ArrowDown' ? 1 : -1);
          if (i >= 0) m.sub.sel = i;
        } else if (e.code === 'ArrowLeft') m.sub = undefined;
        else if (e.code === 'Enter' || e.code === 'ArrowRight' || this.opts.isRunKey(e.code)) {
          this.runSub();
          return true;
        } else return false;
        this.render();
        return true;
      }
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const i = stepSelection(m.vm.rows, m.sel, e.code === 'ArrowDown' ? 1 : -1);
        if (i >= 0) m.sel = i;
        this.render();
        return true;
      }
      if (e.code === 'ArrowRight') {
        if (m.vm.rows[m.sel]?.submenu) this.openSub();
        return true;
      }
      if (e.code === 'Enter' || this.opts.isRunKey(e.code)) {
        if (!e.repeat) this.run();
        return true;
      }
      return false;
    }
    if (this.sleep) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const opts = alarmOptions(this.sleep.view);
        const i = opts.findIndex((a) => a.id === this.sleep!.alarm);
        const n = opts.length;
        this.sleep.alarm = opts[(i + (e.code === 'ArrowRight' ? 1 : n - 1)) % n]!.id;
        this.renderSleep();
        return true;
      }
      if (e.code === 'Enter' || this.opts.isRunKey(e.code)) {
        if (!e.repeat) this.confirmSleep();
        return true;
      }
      return false;
    }
    if (this.fridgeOpen) {
      if (e.code === 'KeyR') this.takeAllFridge();
      else if (e.code === 'KeyX') this.trashRotten();
      else return false;
      return true;
    }
    return false;
  }

  events(events: readonly SimEvent[]): void {
    for (const e of events) if (e.type === 'vhsWatched') this.watched.add(e.vhs);
  }

  /** Per frame: refresh the menu from the sim, follow the opened container, watch panel. */
  frame(now: number, tick: number): void {
    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    const s = this.opts.state();
    if (s.death || !s.player.alive || s.player.sleeping) {
      this.closeMenu();
      this.closeSleep();
    }
    const p = this.opts.player();
    if (this.menu) {
      const m = this.menu;
      if (p && Math.hypot(p.x - m.from.x, p.y - m.from.y) > CLOSE_WALK_TILES) this.closeMenu();
      else {
        // Out of reach (the sim drops it from the list) closes the menu.
        const next = this.opts.source.byId(m.view.furnitureId);
        if (!next) this.closeMenu();
        else {
          m.view = next;
          m.vm = this.vm(next);
          if (!m.vm.rows[m.sel]?.enabled) m.sel = stepSelection(m.vm.rows, Math.max(0, m.sel), 1);
          if (m.sub && !m.vm.rows[m.sel]?.submenu) m.sub = undefined;
          this.render();
        }
      }
    }
    // Fridge window follows the opened container.
    const c = s.container;
    if (c?.id !== this.dismissed) this.dismissed = undefined;
    if (c && this.handlesContainer(c) && c.id !== this.dismissed) {
      this.fridgeId = c.id;
      const vm = fridgeVM(c, { player: p, power: powerOn(s) });
      const k = JSON.stringify(vm);
      if (k !== this.fridgeKey) {
        this.fridgeKey = k;
        this.fridgeEl.innerHTML = fridgeHtml(vm, {
          take: 'R',
          trash: 'X',
          close: this.opts.keys().close,
        });
      }
      this.fridgeEl.hidden = false;
    } else if (this.fridgeId !== undefined) {
      this.fridgeId = undefined;
      this.fridgeKey = '';
      this.fridgeEl.hidden = true;
    }
    // Watching panel.
    const w = watchVM(s, this.opts.content(), {
      tick,
      tickMs: this.opts.tickMs,
      surface: this.opts.surfaces().here,
      watched: this.watched,
    });
    if (w) {
      const k = JSON.stringify(w);
      if (k !== this.watchKey) {
        this.watchKey = k;
        this.watchEl.innerHTML = watchHtml(w, this.opts.keys().close);
      }
      this.watchEl.hidden = false;
    } else if (!this.watchEl.hidden) {
      this.watchEl.hidden = true;
      this.watchKey = '';
    }
    if (this.sleep) this.renderSleep();
  }

  private vm(view: FurnitureView): FurnMenuVM {
    return furnitureMenuVM(view, {
      state: this.opts.state(),
      content: this.opts.content(),
      player: this.opts.player(),
      watched: this.watched,
      utilities: this.opts.state().utilities,
    });
  }

  private subRows(): readonly FurnSubRowVM[] {
    const m = this.menu;
    return (m && m.vm.rows[m.sel]?.children) ?? [];
  }

  private run(): void {
    const m = this.menu;
    const row = m?.vm.rows[m.sel];
    if (!m || !row?.enabled) return;
    if (row.submenu) {
      this.openSub();
      return;
    }
    if (DIALOG_ACTIONS.has(row.id)) {
      this.closeMenu();
      this.sleep = { view: m.view, alarm: DEFAULT_ALARM };
      this.renderSleep();
      return;
    }
    this.opts.source.use(m.view, row.id);
    this.closeMenu();
  }

  private openSub(): void {
    if (!this.menu) return;
    const kids = this.menu.vm.rows[this.menu.sel]?.children ?? [];
    this.menu.sub = { sel: Math.max(0, stepSelection(kids, -1, 1)) };
    this.render();
  }

  /** Runs the selected submenu entry (`lockpick:<itemId>`, `insert-tape:<itemId>`, …). */
  private runSub(): void {
    const m = this.menu;
    const sub = m?.sub ? this.subRows()[m.sub.sel] : undefined;
    if (!m || !sub?.enabled) return;
    this.opts.source.use(m.view, sub.actionId);
    this.closeMenu();
  }

  private render(): void {
    const m = this.menu;
    if (!m) return;
    this.menuEl.innerHTML = menuHtml(m.vm, m.sub ? -1 : m.sel, this.opts.keys());
    if (m.sub) {
      const rows = this.menuEl.querySelectorAll<HTMLElement>('.dz-fm__row');
      rows[m.sel]?.setAttribute('data-open', 'true');
    }
    this.menuEl.style.left = `${m.x}px`;
    this.menuEl.style.top = `${m.y}px`;
    this.menuEl.hidden = false;
    if (m.sub) {
      this.subEl.innerHTML = subHtml(m.vm.rows[m.sel]!, m.sub.sel);
      const r = this.menuEl.getBoundingClientRect();
      const root = this.opts.root.getBoundingClientRect();
      const w = this.opts.root.clientWidth;
      const left = r.right - root.left + 6;
      this.subEl.style.left = `${left + MENU_W > w ? Math.max(8, r.left - root.left - MENU_W - 6) : left}px`;
      this.subEl.style.top = `${m.y}px`;
      this.subEl.hidden = false;
    } else this.subEl.hidden = true;
  }

  private renderSleep(): void {
    const sl = this.sleep;
    if (!sl) return;
    const s = this.opts.state();
    const cfg = this.opts.content().sleep ?? DEFAULT_SLEEP_SETTINGS;
    const action = sl.view.actions.find((a) => a.id === 'sleep');
    const surf = this.opts.surfaces();
    const vm = sleepChoiceVM(s, cfg, {
      ...surf,
      action,
      alarms: alarmOptions(sl.view),
      alarm: sl.alarm,
    });
    const k = JSON.stringify(vm);
    if (k !== this.sleepKey) {
      this.sleepKey = k;
      this.sleepEl.innerHTML = sleepHtml(vm, this.opts.keys());
    }
    this.sleepEl.hidden = false;
  }

  private confirmSleep(): void {
    const sl = this.sleep;
    if (!sl) return;
    const s = this.opts.state();
    const cfg = this.opts.content().sleep ?? DEFAULT_SLEEP_SETTINGS;
    const action = sl.view.actions.find((a) => a.id === 'sleep');
    if (!sleepChoiceVM(s, cfg, { ...this.opts.surfaces(), action }).canSleep) return;
    const alarm = alarmOptions(sl.view).some((a) => a.id === sl.alarm) ? sl.alarm : DEFAULT_ALARM;
    this.opts.source.use(sl.view, alarm);
    this.closeSleep();
  }

  private closeSleep(): void {
    if (!this.sleep) return;
    this.sleep = undefined;
    this.sleepKey = '';
    this.sleepEl.hidden = true;
  }

  private fridgeContainer(): ContainerView | undefined {
    const c = this.opts.state().container;
    return c && c.id === this.fridgeId ? c : undefined;
  }

  private closeFridge(): void {
    if (this.fridgeId === undefined) return;
    this.dismissed = this.fridgeId;
    this.fridgeId = undefined;
    this.fridgeKey = '';
    this.fridgeEl.hidden = true;
    this.opts.send({ type: 'closeContainer' });
  }

  private takeAllFridge(): void {
    const c = this.fridgeContainer();
    if (c) this.opts.send({ type: 'takeAll', container: c.id });
  }

  /** „Wyrzuć zepsute”: take each rotten stack and drop it on the ground (no direct command yet). */
  private trashRotten(): void {
    const c = this.fridgeContainer();
    if (!c) return;
    for (const it of c.items) {
      if (it.freshness !== 'rotten') continue;
      this.opts.send({ type: 'takeItem', container: c.id, item: it.id, count: it.count });
      this.opts.send({ type: 'drop', item: it.id, count: it.count });
    }
  }
}

/** Fridge / freezer containers get the fridge window (`base:fridge`, `base:fridge-freezer`, …). */
const FRIDGE_TYPE = /fridge|freezer/;

/** Mains or generator power now; undefined = the sim has not said (no utilities yet). */
function powerOn(s: GameState): boolean | undefined {
  const u = s.utilities;
  return u ? u.power || u.powerSource !== null : undefined;
}

function rowIndex(t: EventTarget | null): number | undefined {
  const el = (t as HTMLElement | null)?.closest?.<HTMLElement>('[data-i]');
  return el ? Number(el.dataset.i) : undefined;
}
