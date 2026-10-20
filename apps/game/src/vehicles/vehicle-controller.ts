import type { ItemView, SimEvent, SnapshotVehicle, VehicleStateView } from '@deadzone/protocol';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex, HudVehicleSettings, HudVehicleType } from '../hud/content-index.js';
import { actionProgress } from '../hud/hud-model.js';
import { ownItems } from '../hud/loot-model.js';
import type { PromptVM } from '../hud/v2/interact-prompt.js';
import type { CommandBody } from '../sim/sim-client.js';
import type { Anchor, BarVM, MenuVM, RefuelVM, RepairVM, VehicleHudVM } from './vehicle-hud.js';
import {
  carPanelVM,
  defaultItem,
  distToBody,
  fillCan,
  fillerPoint,
  fmt1,
  fmtN,
  fullTankPlan,
  hasTag,
  hotwireChance,
  menuItems,
  nearestDoor,
  nextFullStep,
  nextRepairable,
  pickTarget,
  pourCan,
  pumpSource,
  rejectToast,
  repairRows,
  skillLevel,
  trunkPoint,
  VEHICLE_COMMANDS,
  vehicleTypeName,
  type MenuItemVM,
  type RejectToastVM,
  type RepairRowVM,
} from './vehicle-model.js';
import { skillName } from '../creator/creator-labels.js';

/** Hold F this long at a car: the context menu (spec §2 [ZAŁ.]). */
export const MENU_HOLD_MS = 400;
/** Hold R this long in the driver seat: take the key (spec [ZAŁ.]). */
export const KEY_HOLD_MS = 500;
/** Rejection toast time (spec [ZAŁ.]). */
export const TOAST_MS = 2500;
/** The `[R] silnik [F] wysiądź` hint hides after this much driving. */
export const HINT_HIDE_MS = 6000;
/** A pump this close (tile centre, m) is in reach (`fuel.reachTiles` + half a tile). */
const PUMP_REACH = 2;
/** „Auto obok” for the pump panel: car body within this distance of the pump. */
const CAR_BY_PUMP = 6;

export type HeldAction =
  'interact' | 'reload' | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'vault';

export interface VehicleHost {
  state(): GameState;
  content(): HudContentIndex;
  player(): { x: number; y: number; z: number } | undefined;
  /** Cars of the last snapshot (interpolated poses). */
  cars(): readonly SnapshotVehicle[];
  /** Fuel pump map objects (tile, floor). */
  pumps(): readonly { x: number; y: number; z: number }[];
  send(cmd: CommandBody): void;
  project(x: number, y: number, z: number, h: number): Anchor | undefined;
  isDown(a: HeldAction): boolean;
  /** Key label of a bound action (`F`, `R`, `H`). */
  keyOf(a: 'interact' | 'reload' | 'character'): string;
  /** A modal window (inventory, loot, workshop, map) is open. */
  windowOpen(): boolean;
  /** Distance (m) to the nearest door / non-vehicle container the F key would use otherwise. */
  otherTargetDist(): number;
  /** Opens inventory v3 (the trunk / glovebox tab shows in its container panel). */
  showInventory(): void;
  /** Car ellipse target, `true` while seated (the firearm panel gives way). */
  setTarget(id: number | undefined): void;
  setSeated(seated: boolean): void;
  playerId: number;
  tickMs: number;
}

type Macro =
  | { kind: 'hotwire'; car: number; stage: 'enter' | 'wire' }
  | { kind: 'walk'; car: number; until: number; lastSent: number }
  | {
      kind: 'full';
      car: number;
      pump: { x: number; y: number };
      busy: boolean;
      stage: 'fill' | 'pour' | 'done';
      canL: number;
      fuel: number;
    };

interface ActionMemo {
  key: string;
  canL: number;
  canMax: number;
  fuel: number;
  fuelMax: number;
}

/**
 * Vehicle UI (spec „Pojazdy (UI)”): on foot at a car F tap = default action (get in), hold F /
 * RMB = context menu; in the car WASD drive, Space handbrake, R engine (hold: key out), H horn,
 * L lights, F get out. Client macros: hotwire (get in + hotwire), walk to the trunk, „Do pełna”
 * (pump → can → car, repeated). Rejections become toasts at the player.
 */
export class VehicleController {
  private menu: { car: number; sel: number } | undefined;
  private fAt: number | undefined;
  private rAt: number | undefined;
  private toast: { vm: RejectToastVM & { good?: boolean }; until: number } | undefined;
  private macro: Macro | undefined;
  private refuel:
    { mode: 'car' | 'pump'; car?: number; pump?: { x: number; y: number } } | undefined;
  private repair: { car: number; sel: number } | undefined;
  private target: { car: SnapshotVehicle; dist: number } | undefined;
  private pump: { x: number; y: number; z: number; dist: number } | undefined;
  private lastDrive = '';
  private lights: boolean | undefined;
  private drivingMs = 0;
  private lastFrame = 0;
  private cancelSent = false;
  private power: 'powered' | 'manual' | undefined;
  private memo: ActionMemo | undefined;
  private readonly searched = new Set<number>();
  /** Last vehicle command sent (`missing-tool` detail from the client's own check). */
  private lastDetail: { command: string; detail: string } | undefined;

  constructor(private readonly host: VehicleHost) {}

  // ── Queries ──────────────────────────────────────────────────────────────────────────────

  private get settings(): HudVehicleSettings | undefined {
    return this.host.content().vehicles;
  }

  private view(id: number): VehicleStateView | undefined {
    return this.host.state().vehicles.find((v) => v.vehicleId === id);
  }

  private car(id: number): SnapshotVehicle | undefined {
    return this.host.cars().find((c) => c.stableId === id);
  }

  typeOf(car: SnapshotVehicle): HudVehicleType | undefined {
    const types = this.host.content().vehicleTypes;
    if (!types) return undefined;
    const t = this.view(car.stableId)?.type;
    return (t ? types.get(t) : undefined) ?? [...types.values()][car.variant];
  }

  private carried(): ItemView[] {
    return ownItems(this.host.state());
  }

  /** Seated in a car. */
  get seated(): boolean {
    return this.host.state().seat !== undefined;
  }

  /** A vehicle window / menu is open (Esc closes it, keys go to it). */
  get open(): boolean {
    return !!(this.menu || this.refuel || this.repair || this.macro?.kind === 'walk');
  }

  close(): void {
    const a = this.host.state().action;
    if (this.refuel && a && ['refuel', 'fillFuel', 'siphonFuel'].includes(a.kind))
      this.host.send({ type: 'cancelAction' });
    if (this.macro?.kind === 'walk') this.host.send({ type: 'move', dx: 0, dy: 0 });
    this.menu = undefined;
    this.refuel = undefined;
    this.repair = undefined;
    this.macro = undefined;
  }

  // ── Input ────────────────────────────────────────────────────────────────────────────────

  /** F pressed; true = handled here (the container / door interaction is skipped). */
  pressInteract(now: number): boolean {
    if (this.repair) {
      this.repairSelected();
      return true;
    }
    if (this.menu) {
      this.choose(this.menu.sel);
      return true;
    }
    if (this.refuel) {
      this.refuelPrimary();
      return true;
    }
    const s = this.host.state();
    if (s.seat) {
      if (s.action?.vehicle) this.host.send({ type: 'cancelAction' });
      else this.host.send({ type: 'exitVehicle' });
      return true;
    }
    if (this.host.windowOpen() || s.container || s.action) return false;
    if (this.target && this.target.dist <= this.host.otherTargetDist()) {
      this.fAt = now;
      return true;
    }
    if (this.pump && this.host.otherTargetDist() > this.pump.dist) {
      this.refuel = { mode: 'pump', pump: { x: this.pump.x, y: this.pump.y } };
      return true;
    }
    return false;
  }

  /** RMB; true = handled (menu at the targeted car instead of a shove). */
  pressSecondary(): boolean {
    if (this.seated || !this.target || this.host.windowOpen()) return false;
    this.menu = { car: this.target.car.stableId, sel: 0 };
    return true;
  }

  /**
   * Touch tap / long press at a floor point (sim m): the car menu when the targeted car is under
   * the finger (within `reach` m of its centre), like RMB on desktop.
   */
  pressSecondaryAt(x: number, y: number, reach = 2.6): boolean {
    const car = this.target?.car;
    if (!car || Math.hypot(car.x - x, car.y - y) > reach) return false;
    return this.pressSecondary();
  }

  /** R pressed; true = handled (in the car: engine, hold = key). */
  pressReload(now: number): boolean {
    if (this.refuel?.mode === 'pump') {
      this.startFull();
      return true;
    }
    if (!this.seated) return false;
    this.rAt = now;
    return true;
  }

  /** H pressed; true = handled (horn). */
  pressCharacter(): boolean {
    if (this.host.state().seat?.seat !== 0) return false;
    this.host.send({ type: 'horn' });
    return true;
  }

  /** Raw keys: arrows / Enter / Tab in the menu and the repair window, L = lights. */
  key(e: KeyboardEvent): boolean {
    if (this.repair) {
      const rows = this.repairRowsOf(this.repair.car);
      if (!rows) return false;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const d = e.code === 'ArrowDown' ? 1 : -1;
        this.repair.sel = (this.repair.sel + d + rows.length) % rows.length;
        return true;
      }
      if (e.code === 'Tab') {
        const n = nextRepairable(rows, this.repair.sel);
        if (n !== undefined) this.repair.sel = n;
        return true;
      }
      return false;
    }
    if (this.menu) {
      const items = this.menuOf(this.menu.car);
      if (!items) return false;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const d = e.code === 'ArrowDown' ? 1 : -1;
        this.menu.sel = (this.menu.sel + d + items.length) % items.length;
        return true;
      }
      if (e.code === 'Enter') {
        this.choose(this.menu.sel);
        return true;
      }
      return false;
    }
    if (e.code === 'KeyL' && !e.repeat && this.host.state().seat?.seat === 0) {
      const car = this.car(this.host.state().seat!.vehicleId);
      this.lights = !(this.lights ?? car?.headlights ?? false);
      this.lastDrive = '';
      return true;
    }
    return false;
  }

  /** HUD clicks (menu rows, buttons, repair rows). */
  action(kind: 'menu' | 'hover' | 'button' | 'row', id: string): void {
    if (kind === 'menu') this.choose(Number(id));
    else if (kind === 'hover' && this.menu) this.menu.sel = Number(id);
    else if (kind === 'row' && this.repair) {
      const rows = this.repairRowsOf(this.repair.car) ?? [];
      const i = id.startsWith('part:') ? rows.findIndex((r) => r.key === id.slice(5)) : Number(id);
      if (i >= 0 && i < rows.length) this.repair.sel = i;
    } else if (kind === 'button') {
      if (id === 'repair') this.repairSelected();
      else if (id === 'next' && this.repair) {
        const n = nextRepairable(this.repairRowsOf(this.repair.car) ?? [], this.repair.sel);
        if (n !== undefined) this.repair.sel = n;
      } else if (id === 'pour') this.startPour();
      else if (id === 'siphon') this.startSiphon();
      else if (id === 'fill') this.startFill();
      else if (id === 'full') this.startFull();
    }
  }

  // ── Menu ─────────────────────────────────────────────────────────────────────────────────

  private menuOf(id: number): MenuItemVM[] | undefined {
    const car = this.car(id);
    const t = car && this.typeOf(car);
    const p = this.host.player();
    const s = this.settings;
    if (!car || !t || !p || !s) return undefined;
    const st = this.host.state();
    return menuItems({
      view: this.view(id),
      car,
      type: t,
      settings: s,
      carried: this.carried(),
      content: this.host.content(),
      skills: st.skills,
      px: p.x,
      py: p.y,
      pump: !!this.pump,
    });
  }

  private choose(i: number): void {
    const id = this.menu?.car;
    if (id === undefined) return;
    const it = this.menuOf(id)?.[i];
    if (!it) return;
    if (it.reason) {
      this.showToast({ title: it.reason.toUpperCase(), text: it.label });
      return;
    }
    this.menu = undefined;
    this.run(it, id);
  }

  private run(it: MenuItemVM, id: number): void {
    const v = this.view(id);
    switch (it.id) {
      case 'enter-driver':
        this.host.send({ type: 'enterVehicle', vehicleId: id, seat: 0 });
        break;
      case 'enter-passenger':
        this.host.send({ type: 'enterVehicle', vehicleId: id, seat: 1 });
        break;
      case 'lock':
        this.host.send({ type: 'lockVehicle', vehicleId: id, locked: !(v?.locked ?? false) });
        break;
      case 'trunk':
        this.openTrunk(id);
        break;
      case 'refuel':
        this.refuel = { mode: 'car', car: id };
        this.startPour();
        break;
      case 'siphon':
        this.refuel = { mode: 'car', car: id };
        this.startSiphon();
        break;
      case 'fill-full':
        if (this.pump) this.refuel = { mode: 'pump', pump: { x: this.pump.x, y: this.pump.y } };
        this.startFull();
        break;
      case 'hotwire':
        this.macro = { kind: 'hotwire', car: id, stage: 'enter' };
        this.host.send({ type: 'enterVehicle', vehicleId: id, seat: 0 });
        break;
      case 'repair':
        this.repair = { car: id, sel: 0 };
        {
          const rows = this.repairRowsOf(id);
          const first = rows?.findIndex((r) => r.state === 'ready' || r.state === 'blocked');
          if (first !== undefined && first >= 0) this.repair.sel = first;
        }
        break;
    }
  }

  // ── Trunk ────────────────────────────────────────────────────────────────────────────────

  /** Opens the trunk (search first, like world storage) or walks to it first ([ZAŁ.]). */
  private openTrunk(id: number, now = performance.now()): void {
    const car = this.car(id);
    const t = car && this.typeOf(car);
    const p = this.host.player();
    const v = this.view(id);
    const s = this.settings;
    if (!car || !t || !p || !s || v?.trunk === undefined) return;
    const tp = trunkPoint(car, t);
    if (Math.hypot(p.x - tp.x, p.y - tp.y) > s.trunkReachTiles * 0.9) {
      this.macro = { kind: 'walk', car: id, until: now + 5000, lastSent: 0 };
      return;
    }
    this.openContainer(v.trunk);
  }

  /** Vehicle containers must be searched once (the sim's `nearby.searched` is true for them). */
  openContainer(id: number): void {
    if (this.searched.has(id)) this.host.send({ type: 'openContainer', container: id });
    else this.host.send({ type: 'search', container: id });
    this.host.showInventory();
  }

  /** True for a trunk / glovebox id (inventory tab switches go through `openContainer`). */
  isVehicleContainer(id: number): boolean {
    return this.host.state().vehicles.some((v) => v.trunk === id || v.glovebox === id);
  }

  // ── Fuel ─────────────────────────────────────────────────────────────────────────────────

  private startPour(): void {
    const id = this.refuel?.car ?? this.macro?.car;
    const s = this.settings;
    const can = s && pourCan(this.carried(), s.fuel.canItem);
    if (id === undefined || !can) return;
    this.host.send({ type: 'refuelVehicle', vehicleId: id, item: can.id });
  }

  private startSiphon(): void {
    const id = this.refuel?.car;
    const s = this.settings;
    const can = s && fillCan(this.carried(), s.fuel.canItem);
    if (id === undefined || !can) return;
    if (!hasTag(this.carried(), this.host.content(), s.fuel.hoseTag))
      this.lastDetail = { command: 'siphonFuel', detail: 'Wąż' };
    this.host.send({ type: 'siphonFuel', vehicleId: id, item: can.id });
  }

  private startFill(): void {
    const pump = this.refuel?.pump ?? this.pump;
    const s = this.settings;
    const can = s && fillCan(this.carried(), s.fuel.canItem);
    if (!pump || !can) return;
    this.host.send({ type: 'fillFuelCan', item: can.id, x: pump.x, y: pump.y });
  }

  private carByPump(): SnapshotVehicle | undefined {
    const pump = this.refuel?.pump ?? this.pump;
    if (!pump) return undefined;
    let best: { car: SnapshotVehicle; d: number } | undefined;
    for (const car of this.host.cars()) {
      const t = this.typeOf(car);
      if (!t) continue;
      const d = distToBody(car, t, pump.x + 0.5, pump.y + 0.5);
      if (d <= CAR_BY_PUMP && (!best || d < best.d)) best = { car, d };
    }
    return best?.car;
  }

  /** „Do pełna” (client macro [ZAŁ.]): fill the can at the pump, pour, repeat. */
  private startFull(): void {
    const pump = this.refuel?.pump ?? this.pump;
    const car = this.carByPump() ?? this.target?.car;
    const s = this.settings;
    if (!pump || !car || !s) return;
    const v = this.view(car.stableId);
    const can = fillCan(this.carried(), s.fuel.canItem);
    if (!v || !can) {
      this.showToast(rejectToast('no-item', 'refuelVehicle'));
      return;
    }
    this.macro = {
      kind: 'full',
      car: car.stableId,
      pump: { x: pump.x, y: pump.y },
      busy: false,
      stage: 'fill',
      canL: can.fuelL ?? 0,
      fuel: v.fuel,
    };
    this.refuel = { mode: 'pump', pump: { x: pump.x, y: pump.y } };
  }

  private stepFull(m: Extract<Macro, { kind: 'full' }>): void {
    const v = this.view(m.car);
    const s = this.settings;
    if (!v || !s || m.busy) return;
    const next = nextFullStep(m.fuel, v.fuelMax, m.canL);
    m.stage = next;
    if (next === 'done') {
      this.macro = undefined;
      this.showToast({
        title: 'PEŁNY BAK',
        text: `${vehicleTypeName(v.type)} ${fmtN(Math.round(m.fuel))} / ${fmtN(v.fuelMax)} l`,
        good: true,
      });
      return;
    }
    const can = fillCan(this.carried(), s.fuel.canItem);
    if (!can) {
      this.macro = undefined;
      return;
    }
    m.busy = true;
    if (next === 'fill')
      this.host.send({ type: 'fillFuelCan', item: can.id, x: m.pump.x, y: m.pump.y });
    else this.host.send({ type: 'refuelVehicle', vehicleId: m.car, item: can.id });
  }

  private refuelPrimary(): void {
    const r = this.refuel;
    if (!r) return;
    if (r.mode === 'car') this.startPour();
    else if (this.carByPump()) this.startFull();
    else this.startFill();
  }

  // ── Repair ───────────────────────────────────────────────────────────────────────────────

  private repairRowsOf(id: number): RepairRowVM[] | undefined {
    const car = this.car(id);
    const s = this.settings;
    if (!car || !s) return undefined;
    const st = this.host.state();
    return repairRows(car, s, this.carried(), this.host.content(), st.skills, this.view(id));
  }

  private repairSelected(): void {
    const r = this.repair;
    if (!r) return;
    const row = this.repairRowsOf(r.car)?.[r.sel];
    if (!row?.part) return;
    if (row.state === 'ok') {
      this.showToast({ title: 'SPRAWNA', text: row.label });
      return;
    }
    if (row.state === 'blocked') {
      const miss = row.reqs.find((q) => !q.ok);
      this.showToast({
        title: (miss?.short ?? 'Nie można').toUpperCase(),
        text: `naprawa: ${row.label}`,
      });
      return;
    }
    this.host.send({ type: 'repairVehicle', vehicleId: r.car, part: row.part });
  }

  // ── Events ───────────────────────────────────────────────────────────────────────────────

  private showToast(vm: RejectToastVM & { good?: boolean }, now = performance.now()): void {
    this.toast = { vm, until: now + TOAST_MS };
  }

  events(list: readonly SimEvent[]): void {
    const me = this.host.playerId;
    const s = this.settings;
    for (const e of list) {
      if (e.type === 'commandRejected' && e.playerId === me && VEHICLE_COMMANDS.has(e.command)) {
        const detail =
          this.lastDetail?.command === e.command
            ? this.lastDetail.detail
            : this.detailFor(e.reason, e.command);
        this.showToast(rejectToast(e.reason, e.command, detail));
        if (this.macro && (this.macro.kind !== 'hotwire' || e.command !== 'horn'))
          this.macro = undefined;
      } else if (
        e.type === 'commandRejected' &&
        e.playerId === me &&
        e.command === 'search' &&
        this.macro?.kind !== 'full'
      ) {
        // Locked trunk and the like (search is shared with world storage: only near a car).
        if (e.reason === 'locked') this.showToast(rejectToast('locked', 'search'));
      } else if (e.type === 'vehicleEnter' && e.playerId === me) {
        this.lights = undefined;
        this.lastDrive = '';
        this.drivingMs = 0;
        const m = this.macro;
        if (m?.kind === 'hotwire' && m.car === e.vehicleId && e.seat === 0) {
          m.stage = 'wire';
          this.host.send({ type: 'hotwire' });
        }
      } else if (e.type === 'vehicleExit' && e.playerId === me) {
        this.lastDrive = '';
      } else if (e.type === 'hotwired' && e.playerId === me) {
        if (this.macro?.kind === 'hotwire') this.macro = undefined;
        this.showToast(
          e.success
            ? { title: 'ODPALONY', text: 'silnik pracuje', good: true }
            : { title: 'NIE UDAŁO SIĘ', text: 'spróbuj ponownie' },
        );
      } else if (e.type === 'vehicleKeyTaken' && e.playerId === me) {
        this.showToast({ title: 'KLUCZYK W EKWIPUNKU', text: 'wyjęty ze stacyjki', good: true });
      } else if (e.type === 'vehicleLocked' && e.playerId === me) {
        this.showToast({
          title: e.locked ? 'ZAMKNIĘTE' : 'OTWARTE',
          text: e.by === 'window' ? 'przez zbitą szybę' : 'auto',
          good: true,
        });
      } else if (e.type === 'partRepaired' && e.playerId === me) {
        const row = this.repair
          ? this.repairRowsOf(this.repair.car)?.find((r) => r.part === e.part)
          : undefined;
        this.showToast({
          title: 'NAPRAWIONO',
          text: `${row?.label ?? e.part} · ${Math.round(e.hp)}%`,
          good: true,
        });
      } else if (e.type === 'refueled' && e.playerId === me) {
        const m = this.macro;
        if (m?.kind === 'full') {
          m.busy = false;
          m.canL = e.canL;
          if (e.fuel !== undefined) m.fuel = e.fuel;
        }
      } else if (e.type === 'actionStarted' && e.playerId === me && e.action === 'fillFuel' && s) {
        const can = this.carried().find((i) => i.id === e.item);
        const litres = (can?.fuelMaxL ?? 10) - (can?.fuelL ?? 0);
        const sec = ((e.endTick - e.tick) * this.host.tickMs) / 1000;
        this.power = pumpSource(litres, sec, s) ?? this.power;
      } else if (e.type === 'actionInterrupted' && e.playerId === me) {
        if (this.macro?.kind === 'full' || this.macro?.kind === 'hotwire') this.macro = undefined;
      }
    }
  }

  /** What is missing for a rejected command, from the client's own check (sim sends no detail). */
  private detailFor(reason: string, command: string): string | undefined {
    const s = this.settings;
    if (!s) return undefined;
    if (command === 'hotwire' && reason === 'skill-too-low') {
      const lvl = skillLevel(this.host.state().skills, s.hotwire.electricalSkill);
      return `${skillName(s.hotwire.electricalSkill)} ${s.hotwire.minElectrical} · masz ${lvl}`;
    }
    if (command === 'repairVehicle' && this.repair) {
      const row = this.repairRowsOf(this.repair.car)?.[this.repair.sel];
      const miss = row?.reqs.find((q) => !q.ok);
      if (!miss) return undefined;
      return miss.kind === 'skill' ? miss.short : miss.short.replace(/^brak: /, '');
    }
    if (command === 'siphonFuel' && reason === 'missing-tool') return 'Wąż';
    return undefined;
  }

  // ── Frame ────────────────────────────────────────────────────────────────────────────────

  /** Per frame: driving, holds, macros. Returns the vehicle HUD and a prompt override. */
  frame(now: number, tick: number): { hud: VehicleHudVM; prompt?: PromptVM } {
    const h = this.host;
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 0;
    this.lastFrame = now;
    const s = h.state();
    const p = h.player();
    const settings = this.settings;
    const seat = s.seat;
    h.setSeated(!!seat);
    for (const v of s.vehicles) {
      if (s.container && (s.container.id === v.trunk || s.container.id === v.glovebox))
        this.searched.add(s.container.id);
    }
    // Targets on foot.
    this.target =
      !seat && p && !h.windowOpen() && !s.death
        ? pickTarget(h.cars(), (c) => this.typeOf(c), p.x, p.y, p.z)
        : undefined;
    this.pump = undefined;
    if (!seat && p) {
      for (const q of h.pumps()) {
        if (q.z !== Math.floor(p.z + 1e-3)) continue;
        const d = Math.hypot(q.x + 0.5 - p.x, q.y + 0.5 - p.y);
        if (d <= PUMP_REACH && (!this.pump || d < this.pump.dist)) this.pump = { ...q, dist: d };
      }
    }
    h.setTarget(this.menu?.car ?? this.target?.car.stableId);
    if (this.menu && (!this.target || this.target.car.stableId !== this.menu.car || seat))
      this.menu = undefined;
    // F hold → menu, tap → default action.
    if (this.fAt !== undefined) {
      const t = this.target;
      if (!t) this.fAt = undefined;
      else if (h.isDown('interact')) {
        if (now - this.fAt >= MENU_HOLD_MS) {
          this.fAt = undefined;
          this.menu = { car: t.car.stableId, sel: 0 };
        }
      } else if (now - this.fAt >= MENU_HOLD_MS) {
        // Released after a long hold seen only now (slow frame): still a hold.
        this.fAt = undefined;
        this.menu = { car: t.car.stableId, sel: 0 };
      } else {
        this.fAt = undefined;
        const items = this.menuOf(t.car.stableId) ?? [];
        const ty = this.typeOf(t.car);
        const near = p && ty ? nearestDoor(t.car, ty, p.x, p.y).seat : 0;
        const it = defaultItem(items, near);
        if (it) this.run(it, t.car.stableId);
        else this.menu = { car: t.car.stableId, sel: 0 };
      }
    }
    // R in the car: tap = engine, hold = take the key.
    if (this.rAt !== undefined) {
      const v = seat ? this.view(seat.vehicleId) : undefined;
      if (!seat || seat.seat !== 0 || !v) this.rAt = undefined;
      else if (h.isDown('reload')) {
        if (now - this.rAt >= KEY_HOLD_MS) {
          this.rAt = undefined;
          if (v.keyInIgnition) h.send({ type: 'takeVehicleKey' });
          else this.showToast({ title: 'BRAK KLUCZYKA', text: 'w stacyjce nie ma kluczyka' });
        }
      } else {
        this.rAt = undefined;
        h.send({ type: 'vehicleEngine', on: !v.engineOn });
      }
    }
    // Driving.
    const seatCar = seat ? this.car(seat.vehicleId) : undefined;
    if (seat?.seat === 0 && seatCar && !h.windowOpen() && !this.repair) {
      const up = h.isDown('moveUp');
      const down = h.isDown('moveDown');
      const steer = (h.isDown('moveRight') ? 1 : 0) - (h.isDown('moveLeft') ? 1 : 0);
      const hb = h.isDown('vault');
      if (s.action?.kind === 'hotwire' && (up || down)) {
        if (!this.cancelSent) h.send({ type: 'cancelAction' });
        this.cancelSent = true;
      } else this.cancelSent = false;
      const lights = this.lights ?? seatCar.headlights;
      const sig = `${up}|${down}|${steer}|${hb}|${lights}`;
      if (sig !== this.lastDrive && s.action?.kind !== 'hotwire') {
        this.lastDrive = sig;
        h.send({
          type: 'drive',
          throttle: up ? 1 : 0,
          brake: down ? 1 : 0,
          steer,
          handbrake: hb,
          headlights: lights,
        });
      }
    }
    if (seatCar) {
      this.drivingMs = Math.abs(seatCar.speed) > 1 ? this.drivingMs + dt : 0;
    }
    // Macros.
    const m = this.macro;
    if (m?.kind === 'walk' && p) {
      const car = this.car(m.car);
      const t = car && this.typeOf(car);
      const moved = (['moveUp', 'moveDown', 'moveLeft', 'moveRight'] as const).some((a) =>
        h.isDown(a),
      );
      if (!car || !t || !settings || now > m.until || moved || seat) {
        if (!moved) h.send({ type: 'move', dx: 0, dy: 0 });
        this.macro = undefined;
      } else {
        const tp = trunkPoint(car, t);
        const dx = tp.x - p.x;
        const dy = tp.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d <= settings.trunkReachTiles * 0.6) {
          h.send({ type: 'move', dx: 0, dy: 0 });
          this.macro = undefined;
          this.openTrunk(m.car, now);
        } else if (now - m.lastSent > 150) {
          m.lastSent = now;
          h.send({ type: 'move', dx: dx / d, dy: dy / d });
        }
      }
    } else if (m?.kind === 'full' && !s.action) this.stepFull(m);
    // Remember levels at the start of a fuel action (live estimates while it runs).
    const a = s.action;
    if (a && ['refuel', 'fillFuel', 'siphonFuel'].includes(a.kind)) {
      const key = `${a.kind}:${a.startTick}`;
      if (this.memo?.key !== key) {
        const can = this.carried().find((i) => i.id === a.item);
        const v = a.vehicle ? this.view(a.vehicle.vehicleId) : undefined;
        this.memo = {
          key,
          canL: can?.fuelL ?? 0,
          canMax: can?.fuelMaxL ?? 10,
          fuel: v?.fuel ?? 0,
          fuelMax: v?.fuelMax ?? 50,
        };
      }
    }
    if (this.toast && now > this.toast.until) this.toast = undefined;
    if (this.repair && !this.car(this.repair.car)) this.repair = undefined;
    if (this.refuel?.mode === 'car' && this.refuel.car !== undefined && !this.car(this.refuel.car))
      this.refuel = undefined;
    return this.build(now, tick, p);
  }

  private build(
    now: number,
    tick: number,
    p: { x: number; y: number; z: number } | undefined,
  ): { hud: VehicleHudVM; prompt?: PromptVM } {
    const h = this.host;
    const s = h.state();
    const settings = this.settings;
    const hud: VehicleHudVM = {};
    let prompt: PromptVM | undefined;
    const seat = s.seat;
    const keyF = h.keyOf('interact');
    if (seat) {
      const v = this.view(seat.vehicleId);
      const car = this.car(seat.vehicleId);
      if (v) {
        hud.panel = {
          ...carPanelVM(v, car, seat.seat),
          ...(car && this.lights !== undefined ? { headlights: this.lights } : {}),
          hints: this.drivingMs < HINT_HIDE_MS,
          keys: { engine: h.keyOf('reload'), exit: keyF, horn: h.keyOf('character'), light: 'L' },
        };
      }
    }
    const a = s.action;
    const anchorCar = (id: number, hgt: number): Anchor | undefined => {
      const c = this.car(id);
      return c ? h.project(c.x, c.y, c.z, hgt) : undefined;
    };
    // Timed vehicle actions: the search ring.
    if (
      a?.vehicle &&
      settings &&
      (a.kind === 'hotwire' ||
        a.kind === 'enterVehicle' ||
        a.kind === 'exitVehicle' ||
        a.kind === 'repairVehicle')
    ) {
      const at = anchorCar(a.vehicle.vehicleId, 1.6);
      const v = this.view(a.vehicle.vehicleId);
      const chance = Math.round(hotwireChance(settings, s.skills) * 100);
      const seconds = ((a.endTick - a.startTick) * h.tickMs) / 1000;
      const progress = actionProgress(s, tick) ?? a.progress ?? 0;
      const row =
        a.kind === 'repairVehicle' && this.repair
          ? this.repairRowsOf(this.repair.car)?.find((r) => r.part === a.vehicle?.part)
          : undefined;
      const titles: Record<string, string> = {
        hotwire: 'Odpalanie na krótko',
        enterVehicle: 'Wsiadanie',
        exitVehicle: 'Wysiadanie',
        repairVehicle: 'Naprawa',
      };
      const name =
        a.kind === 'hotwire'
          ? `szansa ${chance}% · [W/S] przerywa`
          : a.kind === 'repairVehicle'
            ? (row?.label ?? 'część')
            : v
              ? vehicleTypeName(v.type)
              : 'Auto';
      if (at && !this.repair)
        prompt = {
          mode: 'search',
          ...at,
          key: keyF,
          progress,
          name,
          seconds,
          title: titles[a.kind] ?? '',
        };
      if (this.repair && a.kind === 'repairVehicle')
        this.repairRunning = {
          label: `Naprawa: ${row?.label ?? ''}`,
          left: `${fmt1(Math.max(0, seconds * (1 - progress)))} s`,
        };
    } else this.repairRunning = undefined;
    // Fuel actions: the 28 px ring + chip at the player.
    const memo = this.memo;
    const fuelAction = a && ['refuel', 'fillFuel', 'siphonFuel'].includes(a.kind) ? a : undefined;
    const progress = fuelAction ? (actionProgress(s, tick) ?? 0) : 0;
    let live: { canL: number; fuel: number; rate: number; total: number } | undefined;
    if (fuelAction && memo && settings) {
      const sec = ((fuelAction.endTick - fuelAction.startTick) * h.tickMs) / 1000;
      if (fuelAction.kind === 'refuel') {
        const total = Math.min(memo.canL, memo.fuelMax - memo.fuel);
        live = {
          canL: memo.canL - total * progress,
          fuel: memo.fuel + total * progress,
          rate: settings.fuel.refuelLps,
          total,
        };
      } else if (fuelAction.kind === 'siphonFuel') {
        const total = Math.min(memo.fuel, memo.canMax - memo.canL);
        live = {
          canL: memo.canL + total * progress,
          fuel: memo.fuel - total * progress,
          rate: settings.fuel.siphonLps,
          total,
        };
      } else {
        const total = memo.canMax - memo.canL;
        live = {
          canL: memo.canL + total * progress,
          fuel: 0,
          rate: sec > 0 ? total / sec : 0,
          total,
        };
      }
      const at = p ? h.project(p.x, p.y, p.z, 2.1) : undefined;
      if (at) {
        const sign = fuelAction.kind === 'siphonFuel' ? '−' : '+';
        const sub =
          fuelAction.kind === 'fillFuel'
            ? `kanister ${fmt1(live.canL)} / ${fmtN(memo.canMax)} l`
            : `auto ${fmt1(live.fuel)} / ${fmtN(memo.fuelMax)} l`;
        hud.chip = { x: at.x + 26, y: at.y, progress, text: `${sign}${fmt1(live.rate)} l/s`, sub };
      }
    }
    // Menu.
    if (this.menu) {
      const items = this.menuOf(this.menu.car);
      const car = this.car(this.menu.car);
      const v = this.view(this.menu.car);
      const at = car ? h.project(car.x, car.y, car.z, 1.2) : undefined;
      if (items && car && at) {
        const k = this.scale();
        const x = Math.max(8, at.x - (282 + 70) * k);
        const y = Math.max(50 * k, at.y - 130 * k);
        const menu: MenuVM = {
          x,
          y,
          title: vehicleTypeName(v?.type ?? '').toUpperCase(),
          dist: `${fmt1(this.target?.dist ?? 0)} m`,
          chips: [
            {
              icon: v?.locked ? 'lock' : 'unlock',
              text: v?.locked ? 'ZAMKNIĘTE' : 'OTWARTE',
              ...(v?.locked ? { tone: 'acc' as const } : {}),
            },
            { icon: 'engine', text: v?.engineOn ? 'WŁ.' : 'WYŁ.' },
            {
              icon: 'fuel',
              text: v ? `${Math.floor(v.fuel)} / ${fmtN(v.fuelMax)} l` : '—',
              tone: 'acc',
            },
          ],
          items,
          sel: Math.min(this.menu.sel, items.length - 1),
          key: keyF,
        };
        hud.menu = menu;
      }
    } else if (!seat && !a && this.target && this.target.dist <= h.otherTargetDist() && p) {
      // Prompt at the car: [F] Wsiądź · kierowca / przytrzymaj F · menu.
      const car = this.target.car;
      const t = this.typeOf(car);
      const items = this.menuOf(car.stableId) ?? [];
      const near = t ? nearestDoor(car, t, p.x, p.y).seat : 0;
      const it = defaultItem(items, near);
      const at = h.project(car.x, car.y, car.z, 1.5);
      if (at)
        prompt = {
          mode: 'prompt',
          ...at,
          key: keyF,
          search: true,
          label: it?.label ?? 'Auto',
          hold: 'menu',
        };
    } else if (
      !seat &&
      !a &&
      this.pump &&
      !this.refuel &&
      p &&
      h.otherTargetDist() > this.pump.dist
    ) {
      const at = h.project(this.pump.x + 0.5, this.pump.y + 0.5, this.pump.z, 1.6);
      if (at)
        prompt = { mode: 'prompt', ...at, key: keyF, search: false, label: 'Dystrybutor paliwa' };
    }
    // Refuel panel.
    const rv =
      this.refuel && settings ? this.refuelVM(live, fuelAction?.kind, now, progress) : undefined;
    if (rv) hud.refuel = rv;
    // Repair window.
    if (this.repair) {
      const rows = this.repairRowsOf(this.repair.car);
      const car = this.car(this.repair.car);
      const v = this.view(this.repair.car);
      if (rows && car && settings) {
        const sel = Math.min(this.repair.sel, rows.length - 1);
        const hp: Record<string, number> = {};
        for (const r of rows) if (r.hp !== undefined) hp[r.key] = r.hp;
        const example = rows.find((r, i) => i !== sel && r.state === 'blocked');
        const t = this.typeOf(car);
        const dist = p && t ? distToBody(car, t, p.x, p.y) : 0;
        const vm: RepairVM = {
          sub: `${vehicleTypeName(v?.type ?? '')} · ${fmt1(dist)} m`,
          skill: `${skillName(settings.repair.skill)} ${skillLevel(s.skills, settings.repair.skill)}`,
          rows,
          sel,
          hp,
          ...(example ? { example } : {}),
          ...(this.repairRunning ? { running: this.repairRunning } : {}),
        };
        hud.repair = vm;
      }
    }
    if (this.toast && p) {
      const at = h.project(p.x, p.y, p.z, 0);
      if (at) hud.toast = { ...this.toast.vm, x: at.x, y: at.y + 34 * this.scale() };
    }
    const showPrompt = prompt && !(this.repair && prompt.mode === 'prompt');
    return { hud, ...(prompt && showPrompt ? { prompt } : {}) };
  }

  private repairRunning: { label: string; left: string } | undefined;

  private scale(): number {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--hud2-s');
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private refuelVM(
    live: { canL: number; fuel: number; rate: number; total: number } | undefined,
    kind: string | undefined,
    now: number,
    progress: number,
  ): RefuelVM | undefined {
    const r = this.refuel!;
    const s = this.settings!;
    const carried = this.carried();
    const p = this.host.player();
    const st = this.host.state();
    void now;
    if (r.mode === 'car' && r.car !== undefined) {
      const car = this.car(r.car);
      const v = this.view(r.car);
      const t = car && this.typeOf(car);
      if (!car || !v || !t) return undefined;
      const fp = fillerPoint(car, t);
      const can =
        (kind && st.action?.item !== undefined
          ? carried.find((i) => i.id === st.action?.item)
          : undefined) ?? pourCan(carried, s.fuel.canItem);
      const canL = live?.canL ?? can?.fuelL ?? 0;
      const canMax = can?.fuelMaxL ?? 10;
      const fuel = live && kind !== 'fillFuel' ? live.fuel : v.fuel;
      const siphon = kind === 'siphonFuel';
      const sec = st.action
        ? ((st.action.endTick - st.action.startTick) * this.host.tickMs) / 1000
        : 0;
      const bars: BarVM[] = [
        {
          label: 'KANISTER',
          sub: 'w rękach',
          value: fmt1(canL),
          max: `${fmtN(canMax)} l`,
          frac: canL / Math.max(0.01, canMax),
          rate: kind
            ? `${siphon ? '+' : '−'}${fmt1(siphon ? s.fuel.siphonLps : s.fuel.refuelLps)} l/s`
            : '',
          color: '#4FA8C8',
          icon: s.fuel.canItem,
        },
        {
          label: 'AUTO',
          sub: vehicleTypeName(v.type),
          value: fmt1(fuel),
          max: `${fmtN(v.fuelMax)} l`,
          frac: fuel / Math.max(0.01, v.fuelMax),
          ...(!siphon
            ? { ghost: Math.min(v.fuelMax, fuel + canL) / Math.max(0.01, v.fuelMax) }
            : {}),
          rate: kind
            ? `${siphon ? '−' : '+'}${fmt1(siphon ? s.fuel.siphonLps : s.fuel.refuelLps)} l/s`
            : '',
          color: '#E0A23A',
          icon: 'car',
        },
      ];
      const pourItem = menuReason(this.menuOfSafe(r.car), 'refuel');
      const siphonItem = menuReason(this.menuOfSafe(r.car), 'siphon');
      return {
        mode: 'car',
        title: 'TANKOWANIE',
        sub: `${vehicleTypeName(v.type)} · wlew ${p ? fmt1(Math.hypot(p.x - fp.x, p.y - fp.y)) : '—'} m`,
        ...(can
          ? {
              source: {
                item: s.fuel.canItem,
                label: 'Kanister',
                detail: `w rękach · ${fmtN(s.fuel.refuelLps)} l/s`,
              },
            }
          : {}),
        powered: `${fmtN(s.fuel.pumpPoweredLps)} l/s`,
        manual: `${fmtN(s.fuel.pumpManualLps)} l/s`,
        bars,
        ...(!siphon
          ? { ghostNote: `po całym kanistrze: ${fmt1(Math.min(v.fuelMax, fuel + canL))} l` }
          : {}),
        ...(kind ? { left: `${fmt1(Math.max(0, sec * (1 - progress)))} s` } : {}),
        note: 'Ruch przerywa. Przelane litry zostają w aucie.',
        buttons: [
          {
            id: 'pour',
            label: 'WLEJ WSZYSTKO',
            key: this.host.keyOf('interact'),
            primary: true,
            ...(pourItem ? { reason: pourItem } : {}),
          },
          { id: 'siphon', label: 'SPUŚĆ WĘŻEM', ...(siphonItem ? { reason: siphonItem } : {}) },
        ],
      };
    }
    const pump = r.pump;
    if (!pump) return undefined;
    const can = fillCan(carried, s.fuel.canItem);
    const canL = kind === 'fillFuel' && live ? live.canL : (can?.fuelL ?? 0);
    const canMax = can?.fuelMaxL ?? 10;
    const filling = kind === 'fillFuel';
    const rate = this.power === 'manual' ? s.fuel.pumpManualLps : s.fuel.pumpPoweredLps;
    const near = this.carByPump();
    const v = near ? this.view(near.stableId) : undefined;
    const m = this.macro?.kind === 'full' ? this.macro : undefined;
    let full: RefuelVM['full'];
    if (near && v) {
      const plan = fullTankPlan(v.fuel, v.fuelMax, can?.fuelL ?? 0, canMax, rate, s.fuel.refuelLps);
      full = {
        title: 'DO PEŁNA · AUTO OBOK',
        total: `${vehicleTypeName(v.type)} ${fmtN(Math.floor(v.fuel))} / ${fmtN(v.fuelMax)} l`,
        steps: [
          {
            label: 'Kanister ← dystrybutor',
            detail: `${fmt1(canL)} → ${fmtN(canMax)} l`,
            active: m?.stage === 'fill',
          },
          {
            label: 'Auto ← kanister',
            detail: `${fmtN(canMax)} l · ${fmtN(s.fuel.refuelLps)} l/s`,
            active: m?.stage === 'pour',
          },
          {
            label: 'powtarzaj do pełna',
            detail: `${fmtN(Math.round(plan.needL))} l · ok. ${Math.round(plan.etaSec)} s`,
            active: false,
          },
        ],
      };
    }
    const sec = st.action
      ? ((st.action.endTick - st.action.startTick) * this.host.tickMs) / 1000
      : 0;
    const fillReason = !can
      ? 'brak kanistra'
      : canMax - (can.fuelL ?? 0) <= 0.05
        ? 'kanister pełny'
        : undefined;
    return {
      mode: 'pump',
      title: 'DYSTRYBUTOR PALIWA',
      sub: p ? `${fmt1(Math.hypot(pump.x + 0.5 - p.x, pump.y + 0.5 - p.y))} m` : '',
      power: this.power,
      powered: `${fmtN(s.fuel.pumpPoweredLps)} l/s`,
      manual: `${fmtN(s.fuel.pumpManualLps)} l/s`,
      bars: [
        {
          label: 'KANISTER',
          sub: 'w rękach',
          value: fmt1(canL),
          max: `${fmtN(canMax)} l`,
          frac: canL / Math.max(0.01, canMax),
          rate: filling ? `+${fmt1(live?.rate ?? rate)} l/s` : '',
          color: '#4FA8C8',
          icon: s.fuel.canItem,
        },
      ],
      ...(filling ? { left: `${fmt1(Math.max(0, sec * (1 - progress)))} s` } : {}),
      ...(full ? { full } : {}),
      buttons: [
        {
          id: 'fill',
          label: 'NAPEŁNIJ KANISTER',
          key: near ? '' : this.host.keyOf('interact'),
          primary: !near,
          ...(fillReason ? { reason: fillReason } : {}),
        },
        ...(near
          ? [
              {
                id: 'full',
                label: m ? 'DO PEŁNA · TRWA' : 'DO PEŁNA',
                key: this.host.keyOf('interact'),
                primary: true,
                ...(!can ? { reason: 'brak kanistra' } : {}),
              },
            ]
          : []),
      ],
    };
  }

  private menuOfSafe(id: number): MenuItemVM[] {
    const items = this.menuOf(id);
    if (items) return items;
    return [];
  }
}

const menuReason = (items: readonly MenuItemVM[], id: MenuItemVM['id']): string | undefined =>
  items.find((i) => i.id === id)?.reason;
