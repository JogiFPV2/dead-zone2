import type {
  CommandRejectReason,
  ItemView,
  SkillView,
  SnapshotVehicle,
  VehiclePart,
  VehicleStateView,
} from '@deadzone/protocol';
import type {
  HudContentIndex,
  HudRepairGroup,
  HudVehicleSettings,
  HudVehicleType,
} from '../hud/content-index.js';
import { craftItemName, tagName } from '../hud/crafting-labels.js';
import { skillName } from '../creator/creator-labels.js';

/**
 * Vehicle UI model (spec „Pojazdy (UI)”): pure helpers for the car panel, the F menu at a car,
 * rejection toasts, the refuel panel with the „Do pełna” macro and the repair window. Gameplay
 * state comes from `SimViewPatch.vehicles`, the physical state from the vehicle snapshot block,
 * requirements from `worldSettings.vehicles` (content).
 */

/** Sim physics constants (`packages/sim/src/vehicles/config.ts`, not in content). */
export const ENTER_RANGE = 1.5;
export const DOOR_GAP = 0.4;
export const ENTER_MAX_SPEED = 1;
/** On foot within this distance (m) of a car body: the car is the F target. */
export const TARGET_REACH = 1.6;
/** Fuel below this share of the tank: red bar and number. */
export const LOW_FUEL = 0.15;

const TYPE_NAMES: Record<string, string> = { 'base:sedan': 'Sedan' };

/** `base:sedan` → `Sedan` (no vehicle names in i18n yet). */
export function vehicleTypeName(type: string): string {
  const known = TYPE_NAMES[type];
  if (known) return known;
  const raw = type.split(':').pop() ?? type;
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/-/g, ' ');
}

/** Polish decimal with one digit (`6,2`). */
export const fmt1 = (n: number): string => n.toFixed(1).replace('.', ',');
/** Polish number without trailing `,0` (`1,5`, `6`). */
export const fmtN = (n: number): string => (Math.round(n * 100) / 100).toString().replace('.', ',');

export interface CarPose {
  x: number;
  y: number;
  z: number;
  facingRad: number;
}

const axes = (c: CarPose): { hx: number; hy: number } => ({
  hx: Math.cos(c.facingRad),
  hy: Math.sin(c.facingRad),
});

/** Door point of `seat` (the sim's `doorPoint`: beside the seat, `DOOR_GAP` outside the side). */
export function doorPoint(c: CarPose, t: HudVehicleType, seat: number): { x: number; y: number } {
  const s = t.seats[seat];
  const { hx, hy } = axes(c);
  const side = s?.doorSide === 'right' ? 1 : -1;
  const lat = side * (t.width / 2 + DOOR_GAP);
  const ox = s?.x ?? 0;
  return { x: c.x + hx * ox - hy * lat, y: c.y + hy * ox + hx * lat };
}

/** Where the trunk is opened: 0.3 m past the rear bumper (the sim's `trunkPoint`). */
export function trunkPoint(c: CarPose, t: HudVehicleType): { x: number; y: number } {
  const { hx, hy } = axes(c);
  const back = t.length / 2 + 0.3;
  return { x: c.x - hx * back, y: c.y - hy * back };
}

/** Fuel filler (rear left quarter), where the refuel panel measures from. */
export function fillerPoint(c: CarPose, t: HudVehicleType): { x: number; y: number } {
  const { hx, hy } = axes(c);
  const back = -t.length * 0.3;
  const lat = -(t.width / 2);
  return { x: c.x + hx * back - hy * lat, y: c.y + hy * back + hx * lat };
}

/** Distance (m) from (px, py) to the car body (oriented box, 0 inside). */
export function distToBody(c: CarPose, t: HudVehicleType, px: number, py: number): number {
  const { hx, hy } = axes(c);
  const dx = px - c.x;
  const dy = py - c.y;
  const lx = Math.abs(dx * hx + dy * hy) - t.length / 2;
  const ly = Math.abs(-dx * hy + dy * hx) - t.width / 2;
  return Math.hypot(Math.max(0, lx), Math.max(0, ly));
}

/** Closest car on the player's floor within `TARGET_REACH` of its body. */
export function pickTarget<C extends CarPose & { stableId: number }>(
  cars: readonly C[],
  typeOf: (car: C) => HudVehicleType | undefined,
  px: number,
  py: number,
  pz: number,
  reach = TARGET_REACH,
): { car: C; dist: number } | undefined {
  let best: { car: C; dist: number } | undefined;
  for (const car of cars) {
    const t = typeOf(car);
    if (!t || Math.floor(car.z + 1e-3) !== Math.floor(pz + 1e-3)) continue;
    const dist = distToBody(car, t, px, py);
    if (dist <= reach && (!best || dist < best.dist)) best = { car, dist };
  }
  return best;
}

/** Seat whose door point is nearest (0 = driver), with its distance. */
export function nearestDoor(
  c: CarPose,
  t: HudVehicleType,
  px: number,
  py: number,
): { seat: number; dist: number } {
  let best = { seat: 0, dist: Infinity };
  t.seats.forEach((_, seat) => {
    const d = doorPoint(c, t, seat);
    const dist = Math.hypot(px - d.x, py - d.y);
    if (dist < best.dist) best = { seat, dist };
  });
  return best;
}

// ── Fuel, speed ──────────────────────────────────────────────────────────────────────────────

export interface FuelVM {
  /** `31 / 50 l`. */
  text: string;
  litres: string;
  max: string;
  frac: number;
  low: boolean;
}

export function fuelVM(fuel: number, fuelMax: number): FuelVM {
  const frac = fuelMax > 0 ? Math.max(0, Math.min(1, fuel / fuelMax)) : 0;
  const litres = String(Math.floor(fuel + 1e-6));
  const max = fmtN(fuelMax);
  return { text: `${litres} / ${max} l`, litres, max, frac, low: frac < LOW_FUEL };
}

/** Speed in km/h from the snapshot `speed` (m/s, signed): `47`, reversing `R 12`. */
export function speedLabel(speed: number): { value: string; reverse: boolean } {
  const kmh = Math.round(Math.abs(speed) * 3.6);
  const reverse = speed < -0.3;
  return { value: reverse ? `R ${kmh}` : String(kmh), reverse };
}

// ── Car panel ────────────────────────────────────────────────────────────────────────────────

export type IgnitionState = 'key' | 'hotwired' | 'none';

export interface CarPanelVM {
  /** `SEDAN`. */
  type: string;
  /** `kierowca` / `pasażer`. */
  seat: string;
  ignition: IgnitionState;
  locked: boolean;
  speed: { value: string; reverse: boolean };
  fuel: FuelVM;
  engine: { text: string; tone: 'on' | 'off' | 'bad' };
  headlights: boolean;
  driver: boolean;
}

export function ignitionState(v: VehicleStateView): IgnitionState {
  if (v.hotwired) return 'hotwired';
  return v.keyInIgnition || v.hasKey ? 'key' : 'none';
}

export function carPanelVM(
  v: VehicleStateView,
  snap: Pick<SnapshotVehicle, 'speed' | 'headlights'> | undefined,
  seat: number,
): CarPanelVM {
  const engine: CarPanelVM['engine'] =
    v.fuel <= 0
      ? { text: 'BRAK PALIWA', tone: 'bad' }
      : v.engineOn
        ? { text: 'SILNIK WŁ.', tone: 'on' }
        : { text: 'SILNIK WYŁ.', tone: 'off' };
  return {
    type: vehicleTypeName(v.type).toUpperCase(),
    seat: seat === 0 ? 'kierowca' : 'pasażer',
    ignition: ignitionState(v),
    locked: v.locked,
    speed: speedLabel(snap?.speed ?? 0),
    fuel: fuelVM(v.fuel, v.fuelMax),
    engine,
    headlights: snap?.headlights ?? false,
    driver: seat === 0,
  };
}

// ── Carried items, skills ────────────────────────────────────────────────────────────────────

export const skillLevel = (skills: readonly SkillView[], id: string): number =>
  skills.find((s) => s.id === id)?.level ?? 0;

export function hasTag(
  carried: readonly ItemView[],
  content: HudContentIndex,
  tag: string,
): boolean {
  return carried.some((i) => content.items.get(i.def)?.tags?.includes(tag));
}

export const countOf = (carried: readonly ItemView[], def: string): number =>
  carried.filter((i) => i.def === def).reduce((n, i) => n + i.count, 0);

/** Carried gas cans, fullest first. */
export function cans(carried: readonly ItemView[], canItem: string): ItemView[] {
  return carried.filter((i) => i.def === canItem).sort((a, b) => (b.fuelL ?? 0) - (a.fuelL ?? 0));
}

/** Can to pour from (most fuel) / to fill (most room). */
export function pourCan(carried: readonly ItemView[], canItem: string): ItemView | undefined {
  return cans(carried, canItem)[0];
}

export function fillCan(carried: readonly ItemView[], canItem: string): ItemView | undefined {
  const list = cans(carried, canItem);
  return list.sort(
    (a, b) => (a.fuelL ?? 0) - (b.fuelL ?? 0) || (b.fuelMaxL ?? 0) - (a.fuelMaxL ?? 0),
  )[0];
}

/** Hotwire success chance (content: `baseChance + E·perE + M·perM`, capped at `maxChance`). */
export function hotwireChance(s: HudVehicleSettings, skills: readonly SkillView[]): number {
  const h = s.hotwire;
  const e = skillLevel(skills, h.electricalSkill);
  const m = skillLevel(skills, h.mechanicsSkill);
  return Math.max(
    0,
    Math.min(h.maxChance, h.baseChance + e * h.chancePerElectrical + m * h.chancePerMechanics),
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────────────────────

export type MenuId =
  | 'enter-driver'
  | 'enter-passenger'
  | 'lock'
  | 'trunk'
  | 'refuel'
  | 'siphon'
  | 'fill-full'
  | 'hotwire'
  | 'repair';

export interface MenuItemVM {
  id: MenuId;
  icon: 'seat' | 'lock' | 'unlock' | 'trunk' | 'fuel' | 'hose' | 'pump' | 'bolt' | 'wrench';
  label: string;
  /** Right column: time / chance / count (`1,5 s`). */
  hint: string;
  /** Unavailable: the reason shown instead of the hint (red), the row is grey. */
  reason?: string;
  /** Divider above this row. */
  divider?: boolean;
  /** Item whose atlas icon replaces `icon` (gas can, hose). */
  item?: string;
}

/** Hose icon in the menu when none is carried (`base:rubber-hose` is the tagged item). */
export const HOSE_ITEM = 'base:rubber-hose';

export interface MenuCtx {
  view: VehicleStateView | undefined;
  car: SnapshotVehicle;
  type: HudVehicleType;
  settings: HudVehicleSettings;
  carried: readonly ItemView[];
  content: HudContentIndex;
  skills: readonly SkillView[];
  px: number;
  py: number;
  /** A fuel pump within reach (`base:fuel-pump` map object). */
  pump: boolean;
}

/** Window on the side of the seat's door is broken (a hand reaches the lock). */
export function doorWindowBroken(car: SnapshotVehicle, t: HudVehicleType, seat: number): boolean {
  const bit = t.seats[seat]?.doorSide === 'right' ? 3 : 2;
  return ((car.windowsBroken ?? 0) & (1 << bit)) !== 0;
}

/** `1 uszkodzenie`, `2 uszkodzenia`, `10 uszkodzeń`. */
export function damageCount(n: number): string {
  if (n === 1) return '1 uszkodzenie';
  const d = n % 10;
  const dd = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'uszkodzenia' : 'uszkodzeń'}`;
}

export function menuItems(c: MenuCtx): MenuItemVM[] {
  const v = c.view;
  const s = c.settings;
  const out: MenuItemVM[] = [];
  const locked = v?.locked ?? false;
  const hasKey = v?.hasKey ?? false;
  const enterSec = `${fmtN(s.enterSec)} s`;
  const moving = Math.abs(c.car.speed) > ENTER_MAX_SPEED;
  const seatItem = (seat: number, id: MenuId, label: string): void => {
    if (seat >= c.type.seats.length) return;
    const taken = seat === 0 && c.car.driverId !== 0;
    const shut = locked && !hasKey && !doorWindowBroken(c.car, c.type, seat);
    const reason = taken ? 'zajęte' : moving ? 'auto jedzie' : shut ? 'zamknięte' : undefined;
    out.push({ id, icon: 'seat', label, hint: enterSec, ...(reason ? { reason } : {}) });
  };
  seatItem(0, 'enter-driver', 'Wsiądź · kierowca');
  seatItem(1, 'enter-passenger', 'Wsiądź · pasażer');
  const atDoor = c.type.seats.some((_, i) => {
    const d = doorPoint(c.car, c.type, i);
    return Math.hypot(c.px - d.x, c.py - d.y) <= ENTER_RANGE;
  });
  out.push({
    id: 'lock',
    icon: locked ? 'unlock' : 'lock',
    label: locked ? 'Otwórz auto' : 'Zamknij auto',
    hint: hasKey ? 'kluczyk' : '',
    divider: true,
    ...(!hasKey ? { reason: 'brak kluczyka' } : !atDoor ? { reason: 'podejdź do drzwi' } : {}),
  });
  const tp = trunkPoint(c.car, c.type);
  const behind = Math.hypot(c.px - tp.x, c.py - tp.y) <= s.trunkReachTiles;
  out.push({
    id: 'trunk',
    icon: 'trunk',
    label: 'Bagażnik',
    hint: behind ? `${fmtN(c.type.trunkCapacity)} kg` : 'podejdź do tyłu',
    ...(locked ? { reason: 'zamknięte' } : v?.trunk === undefined ? { reason: 'brak' } : {}),
  });
  const pour = pourCan(c.carried, s.fuel.canItem);
  const room = (v?.fuelMax ?? c.type.fuelMax) - (v?.fuel ?? 0);
  const canL = pour?.fuelL ?? 0;
  out.push({
    id: 'refuel',
    icon: 'fuel',
    item: s.fuel.canItem,
    label: 'Zatankuj z kanistra',
    hint: `${fmt1(Math.min(canL, room))} l · ${fmtN(s.fuel.refuelLps)} l/s`,
    divider: true,
    ...(!pour
      ? { reason: 'brak kanistra' }
      : canL <= 0.05
        ? { reason: 'pusty kanister' }
        : room <= 0.05
          ? { reason: 'pełny bak' }
          : {}),
  });
  const fill = fillCan(c.carried, s.fuel.canItem);
  const fillRoom = fill ? (fill.fuelMaxL ?? 10) - (fill.fuelL ?? 0) : 0;
  out.push({
    id: 'siphon',
    icon: 'hose',
    item:
      c.carried.find((i) => c.content.items.get(i.def)?.tags?.includes(s.fuel.hoseTag))?.def ??
      HOSE_ITEM,
    label: 'Spuść paliwo',
    hint: `${fmtN(s.fuel.siphonLps)} l/s`,
    ...(!hasTag(c.carried, c.content, s.fuel.hoseTag)
      ? { reason: 'brak węża' }
      : !fill
        ? { reason: 'brak kanistra' }
        : (v?.fuel ?? 0) <= 0.05
          ? { reason: 'pusty bak' }
          : fillRoom <= 0.05
            ? { reason: 'kanister pełny' }
            : {}),
  });
  if (c.pump) {
    const plan = fullTankPlan(
      v?.fuel ?? 0,
      v?.fuelMax ?? c.type.fuelMax,
      fill?.fuelL ?? 0,
      fill?.fuelMaxL ?? 10,
      s.fuel.pumpPoweredLps,
      s.fuel.refuelLps,
    );
    out.push({
      id: 'fill-full',
      icon: 'pump',
      label: 'Do pełna z dystrybutora',
      hint: `${fmtN(Math.round(plan.needL))} l · ok. ${Math.round(plan.etaSec)} s`,
      ...(!fill ? { reason: 'brak kanistra' } : plan.needL <= 0.05 ? { reason: 'pełny bak' } : {}),
    });
  }
  const h = s.hotwire;
  const eLvl = skillLevel(c.skills, h.electricalSkill);
  const mLvl = skillLevel(c.skills, h.mechanicsSkill);
  const chance = Math.round(hotwireChance(s, c.skills) * 100);
  const hotReason = v?.hotwired
    ? 'już odpalony'
    : v?.engineOn
      ? 'silnik pracuje'
      : v?.keyInIgnition
        ? 'kluczyk w stacyjce'
        : hasKey
          ? 'masz kluczyk'
          : eLvl < h.minElectrical
            ? `${skillName(h.electricalSkill)} ${h.minElectrical}`
            : mLvl < h.minMechanics
              ? `${skillName(h.mechanicsSkill)} ${h.minMechanics}`
              : c.car.driverId !== 0
                ? 'zajęte'
                : locked && !doorWindowBroken(c.car, c.type, 0)
                  ? 'zamknięte'
                  : undefined;
  out.push({
    id: 'hotwire',
    icon: 'bolt',
    label: 'Odpal na krótko',
    hint: `${fmtN(s.enterSec)} + ${fmtN(h.sec)} s · ${chance}%`,
    divider: true,
    ...(hotReason ? { reason: hotReason } : {}),
  });
  const damaged = repairRows(c.car, s, c.carried, c.content, c.skills, v).filter(
    (r) => r.part && r.hp !== undefined && r.hp < 100,
  ).length;
  out.push({
    id: 'repair',
    icon: 'wrench',
    label: 'Napraw…',
    hint: damaged ? damageCount(damaged) : 'sprawne',
  });
  return out;
}

/** Default action of an F tap: get in at the nearest door (driver when free), else the menu. */
export function defaultItem(
  items: readonly MenuItemVM[],
  nearSeat: number,
): MenuItemVM | undefined {
  const first = nearSeat === 0 ? 'enter-driver' : 'enter-passenger';
  const order: MenuId[] = [first, first === 'enter-driver' ? 'enter-passenger' : 'enter-driver'];
  for (const id of order) {
    const it = items.find((i) => i.id === id);
    if (it && !it.reason) return it;
  }
  return undefined;
}

// ── Rejections ───────────────────────────────────────────────────────────────────────────────

const REJECT_TITLES: Partial<Record<CommandRejectReason, string>> = {
  locked: 'Zamknięte',
  'no-key': 'Brak kluczyka',
  'no-fuel': 'Brak paliwa',
  'no-space': 'Brak miejsca',
  'missing-tool': 'Brak narzędzia',
  'missing-parts': 'Brak części',
  'skill-too-low': 'Za niska umiejętność',
  'no-station': 'Brak dystrybutora',
  'out-of-range': 'Za daleko',
  'invalid-target': 'Nie można',
  'invalid-state': 'Nie teraz',
  'no-item': 'Brak przedmiotu',
};

const COMMAND_TEXT: Record<string, string> = {
  enterVehicle: 'nie wsiądziesz do auta',
  exitVehicle: 'nie wysiądziesz',
  lockVehicle: 'zamek auta',
  hotwire: 'odpalanie na krótko',
  takeVehicleKey: 'kluczyk',
  vehicleEngine: 'silnik',
  horn: 'klakson',
  refuelVehicle: 'tankowanie z kanistra',
  fillFuelCan: 'napełnianie kanistra',
  siphonFuel: 'spuszczanie paliwa',
  repairVehicle: 'naprawa',
  openContainer: 'bagażnik',
  search: 'bagażnik',
};

export const VEHICLE_COMMANDS: ReadonlySet<string> = new Set([
  'enterVehicle',
  'exitVehicle',
  'lockVehicle',
  'hotwire',
  'takeVehicleKey',
  'vehicleEngine',
  'horn',
  'refuelVehicle',
  'fillFuelCan',
  'siphonFuel',
  'repairVehicle',
]);

export interface RejectToastVM {
  title: string;
  text: string;
}

/**
 * Toast for a rejected vehicle command. The sim sends no `detail` for vehicle rejections, so
 * `detail` (what is missing: `Klucz`, `Złom 1/2`, `Mechanika 2 · masz 1`) comes from the
 * client's own requirement check when it has one.
 */
export function rejectToast(
  reason: CommandRejectReason,
  command: string,
  detail?: string,
): RejectToastVM {
  let title = REJECT_TITLES[reason] ?? 'Nie można';
  let text = COMMAND_TEXT[command] ?? '';
  if (reason === 'no-space' && command === 'exitVehicle') {
    title = 'Brak miejsca';
    text = 'Nie ma jak wysiąść';
  } else if (reason === 'no-space' && (command === 'fillFuelCan' || command === 'siphonFuel')) {
    title = 'Kanister pełny';
    text = command === 'fillFuelCan' ? 'nie zmieści się więcej' : 'opróżnij kanister';
  } else if (reason === 'no-space' && command === 'refuelVehicle') {
    title = 'Pełny bak';
    text = 'auto ma pełny bak';
  } else if (reason === 'no-key' && command === 'lockVehicle') {
    text = 'nie zamkniesz auta z zewnątrz';
  } else if (reason === 'no-fuel' && command === 'fillFuelCan') {
    text = 'dystrybutor jest pusty';
  } else if (reason === 'no-fuel' && command === 'refuelVehicle') {
    text = 'kanister jest pusty';
  } else if (reason === 'no-fuel') {
    text = 'bak jest pusty';
  } else if (reason === 'locked') {
    text =
      command === 'openContainer' || command === 'search'
        ? 'bagażnik zamknięty'
        : 'auto jest zamknięte';
  }
  if (reason === 'missing-tool') title = detail ? `Brak narzędzia: ${detail}` : title;
  else if (reason === 'missing-parts') title = detail ? `Brak części: ${detail}` : title;
  else if (reason === 'skill-too-low' && detail) title = detail;
  return { title: title.toUpperCase(), text };
}

// ── Repair ───────────────────────────────────────────────────────────────────────────────────

export type RepairSection = 'engine' | 'tires' | 'body' | 'windows' | 'other';

export const SECTION_TITLES: Record<RepairSection, string> = {
  engine: 'SILNIK',
  tires: 'OPONY',
  body: 'KAROSERIA I DRZWI',
  windows: 'SZYBY',
  other: 'INNE',
};

export interface RepairReqVM {
  kind: 'tool' | 'part' | 'skill';
  label: string;
  /** Second line (`masz poziom 1`, `w plecaku`). */
  sub: string;
  ok: boolean;
  /** Short form for the NAPRAWA column / rejection example (`Złom 1/2`). */
  short: string;
  /** Item whose atlas icon stands for the requirement (the carried tool / the part). */
  item?: string;
}

export interface RepairRowVM {
  key: string;
  section: RepairSection;
  /** API part; undefined = proposal row (`BRAK W API`). */
  part?: VehiclePart;
  label: string;
  /** 0..100; undefined = no HP (proposal rows). */
  hp?: number;
  /** Status suffix in the label (`kapeć`, `uchodzi`, `zbita`). */
  note?: string;
  state: 'ok' | 'ready' | 'blocked' | 'na';
  /** NAPRAWA column. */
  status: string;
  reqs: RepairReqVM[];
  sec: number;
  /** HP after the repair. */
  after: number;
  xp: number;
  replace: boolean;
}

const GROUP_OF = (part: VehiclePart): 'engine' | 'tire' | 'window' | 'body' =>
  part === 'engine'
    ? 'engine'
    : part.startsWith('tire')
      ? 'tire'
      : part.startsWith('window')
        ? 'window'
        : 'body';

const PART_ROWS: readonly { part: VehiclePart; section: RepairSection; label: string }[] = [
  { part: 'engine', section: 'engine', label: 'Silnik' },
  { part: 'tireFL', section: 'tires', label: 'Opona lewa przednia' },
  { part: 'tireFR', section: 'tires', label: 'Opona prawa przednia' },
  { part: 'tireRL', section: 'tires', label: 'Opona lewa tylna' },
  { part: 'tireRR', section: 'tires', label: 'Opona prawa tylna' },
  { part: 'bodyFront', section: 'body', label: 'Przód' },
  { part: 'bodyRear', section: 'body', label: 'Tył' },
  { part: 'bodyLeft', section: 'body', label: 'Lewy bok · drzwi L' },
  { part: 'bodyRight', section: 'body', label: 'Prawy bok · drzwi P' },
  { part: 'windowFront', section: 'windows', label: 'Szyba przednia' },
  { part: 'windowRear', section: 'windows', label: 'Szyba tylna' },
  { part: 'windowLeft', section: 'windows', label: 'Szyba lewa' },
  { part: 'windowRight', section: 'windows', label: 'Szyba prawa' },
];

/** Part HP 0..100 from the snapshot (windows: only whole / broken). */
export function partHp(car: SnapshotVehicle, part: VehiclePart): number {
  const pct = (v: number | undefined): number => Math.round((v ?? 1) * 100);
  const tires = car.tires ?? [1, 1, 1, 1];
  switch (part) {
    case 'engine':
      return pct(car.engine);
    case 'tireFL':
      return pct(tires[0]);
    case 'tireFR':
      return pct(tires[1]);
    case 'tireRL':
      return pct(tires[2]);
    case 'tireRR':
      return pct(tires[3]);
    case 'bodyFront':
      return pct(car.damage.front);
    case 'bodyRear':
      return pct(car.damage.rear);
    case 'bodyLeft':
      return pct(car.damage.left);
    case 'bodyRight':
      return pct(car.damage.right);
    case 'windowFront':
    case 'windowRear':
    case 'windowLeft':
    case 'windowRight': {
      const bit = ['windowFront', 'windowRear', 'windowLeft', 'windowRight'].indexOf(part);
      return ((car.windowsBroken ?? 0) & (1 << bit)) !== 0 ? 0 : 100;
    }
  }
}

function groupOf(s: HudVehicleSettings, part: VehiclePart): HudRepairGroup {
  return s.repair[GROUP_OF(part)];
}

/** Requirements of repairing `part` against what the player carries and knows. */
export function repairReqs(
  s: HudVehicleSettings,
  part: VehiclePart,
  carried: readonly ItemView[],
  content: HudContentIndex,
  skills: readonly SkillView[],
): RepairReqVM[] {
  const g = groupOf(s, part);
  const out: RepairReqVM[] = [];
  for (const tag of g.tools) {
    const item = carried.find((i) => content.items.get(i.def)?.tags?.includes(tag));
    const tool = tagName(tag);
    out.push({
      kind: 'tool',
      label: `Narzędzie: ${item ? craftItemName(item.def) : tool}`,
      sub: item ? 'narzędzie · nie zużywa się' : `dowolne z tagiem „${tool}”`,
      ok: !!item,
      short: `brak: ${tool}`,
      ...(item ? { item: item.def } : {}),
    });
  }
  for (const p of g.parts) {
    const have = countOf(carried, p.item);
    const name = craftItemName(p.item);
    const w = content.items.get(p.item)?.weightKg;
    out.push({
      kind: 'part',
      label: `Część: ${name} ×${p.count}`,
      sub: `zużywa się${w !== undefined ? ` · ${fmt1(w)} kg` : ''} · masz ${have}`,
      ok: have >= p.count,
      short: have > 0 ? `${name} ${have}/${p.count}` : `brak: ${name}`,
      item: p.item,
    });
  }
  const lvl = skillLevel(skills, s.repair.skill);
  const skill = skillName(s.repair.skill);
  out.push({
    kind: 'skill',
    label: `Umiejętność: ${skill} ${g.minSkill}`,
    sub: `masz poziom ${lvl}`,
    ok: lvl >= g.minSkill,
    short: `${skill} ${g.minSkill} · masz ${lvl}`,
  });
  return out;
}

/** HP after a repair: tyres and windows are replaced (100), the rest heal by skill. */
export function repairedHp(
  s: HudVehicleSettings,
  part: VehiclePart,
  hp: number,
  lvl: number,
): number {
  const kind = GROUP_OF(part);
  if (kind === 'tire' || kind === 'window') return 100;
  const g = s.repair[kind];
  return Math.min(100, Math.round(hp + g.hpBase + lvl * g.hpPerLevel));
}

/** Rows of the STAN AUTA panel, API parts first, then the proposal rows (battery, tank). */
export function repairRows(
  car: SnapshotVehicle,
  s: HudVehicleSettings,
  carried: readonly ItemView[],
  content: HudContentIndex,
  skills: readonly SkillView[],
  view: VehicleStateView | undefined,
): RepairRowVM[] {
  const lvl = skillLevel(skills, s.repair.skill);
  const rows: RepairRowVM[] = PART_ROWS.map(({ part, section, label }) => {
    const hp = partHp(car, part);
    const g = groupOf(s, part);
    const reqs = repairReqs(s, part, carried, content, skills);
    const replace = GROUP_OF(part) === 'tire' || GROUP_OF(part) === 'window';
    const missing = reqs.find((r) => !r.ok);
    const note =
      GROUP_OF(part) === 'tire'
        ? hp <= 0
          ? 'kapeć'
          : hp < 40
            ? 'uchodzi'
            : undefined
        : GROUP_OF(part) === 'window' && hp <= 0
          ? 'zbita'
          : undefined;
    const state: RepairRowVM['state'] = hp >= 100 ? 'ok' : missing ? 'blocked' : 'ready';
    const status =
      state === 'ok'
        ? GROUP_OF(part) === 'window'
          ? 'cała'
          : 'sprawna'
        : missing
          ? missing.short
          : `${replace ? 'wymiana' : 'naprawa'} · ${fmtN(g.sec)} s`;
    return {
      key: part,
      section,
      part,
      label,
      hp,
      ...(note ? { note } : {}),
      state,
      status,
      reqs,
      sec: g.sec,
      after: repairedHp(s, part, hp, lvl),
      xp: g.xp,
      replace,
    };
  });
  const fuel = view
    ? `paliwo ${fmtN(Math.floor(view.fuel))} / ${fmtN(view.fuelMax)} l`
    : 'propozycja';
  rows.push(
    {
      key: 'battery',
      section: 'other',
      label: 'Akumulator',
      state: 'na',
      status: 'propozycja',
      reqs: [],
      sec: 0,
      after: 0,
      xp: 0,
      replace: false,
    },
    {
      key: 'fuelTank',
      section: 'other',
      label: 'Zbiornik paliwa',
      state: 'na',
      status: fuel,
      reqs: [],
      sec: 0,
      after: 0,
      xp: 0,
      replace: false,
    },
  );
  return rows;
}

/** Section summary (right of the section title): `1 kapeć · 1 uchodzi`, `średnio 70%`. */
export function sectionSummary(rows: readonly RepairRowVM[], section: RepairSection): string {
  const list = rows.filter((r) => r.section === section && r.hp !== undefined);
  if (section === 'other') return '';
  if (section === 'engine') {
    const hp = list[0]?.hp ?? 100;
    return hp < 50 ? 'dymi poniżej 50%' : hp < 100 ? 'uszkodzony' : 'sprawny';
  }
  if (section === 'tires') {
    const flat = list.filter((r) => r.note === 'kapeć').length;
    const low = list.filter((r) => r.note === 'uchodzi').length;
    const parts = [flat ? `${flat} kapeć` : '', low ? `${low} uchodzi` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'sprawne';
  }
  if (section === 'windows') {
    const broken = list.filter((r) => (r.hp ?? 100) <= 0).length;
    return broken ? `${broken} zbita` : 'całe';
  }
  const avg = list.reduce((n, r) => n + (r.hp ?? 0), 0) / Math.max(1, list.length);
  return `średnio ${Math.round(avg)}%`;
}

/** HP colour (like durability): > 50 green, > 25 yellow, else red. */
export function hpColor(hp: number): string {
  return hp > 50 ? '#7F9A4E' : hp > 25 ? '#D9B64A' : '#C8453C';
}

/** Next repairable row after `from` (Tab), wrapping; undefined when none. */
export function nextRepairable(rows: readonly RepairRowVM[], from: number): number | undefined {
  for (let k = 1; k <= rows.length; k++) {
    const i = (from + k) % rows.length;
    if (rows[i]?.state === 'ready') return i;
  }
  return undefined;
}

// ── Refuel ───────────────────────────────────────────────────────────────────────────────────

export interface FullTankPlan {
  needL: number;
  /** Fill + pour rounds. */
  rounds: number;
  etaSec: number;
}

/**
 * „Do pełna” macro (client, [ZAŁ.]): fill the can at the pump, pour it into the car, repeat
 * until the tank is full (or the pump is empty). Time = pump time + pour time.
 */
export function fullTankPlan(
  carFuel: number,
  carMax: number,
  canL: number,
  canMax: number,
  pumpLps: number,
  pourLps: number,
): FullTankPlan {
  const needL = Math.max(0, carMax - carFuel);
  if (needL <= 0.05 || canMax <= 0) return { needL: 0, rounds: 0, etaSec: 0 };
  const fromCan = Math.min(canL, needL);
  const rest = needL - fromCan;
  const rounds = Math.ceil(rest / canMax - 1e-6) + (fromCan > 0.05 ? 1 : 0);
  const etaSec = rest / Math.max(0.01, pumpLps) + needL / Math.max(0.01, pourLps);
  return { needL, rounds, etaSec };
}

/** Next macro step from the current levels. */
export function nextFullStep(
  carFuel: number,
  carMax: number,
  canL: number,
): 'fill' | 'pour' | 'done' {
  if (carMax - carFuel <= 0.05) return 'done';
  return canL > 0.05 ? 'pour' : 'fill';
}

/** Pump power from a running fill (`litres / seconds`): ~1,5 = mains, ~0,3 = hand crank. */
export function pumpSource(
  litres: number,
  seconds: number,
  s: HudVehicleSettings,
): 'powered' | 'manual' | undefined {
  if (seconds <= 0 || litres <= 0) return undefined;
  const lps = litres / seconds;
  const mid = (s.fuel.pumpPoweredLps + s.fuel.pumpManualLps) / 2;
  return lps >= mid ? 'powered' : 'manual';
}
