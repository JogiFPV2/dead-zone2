import { isAlarmAction, type AlarmOption } from './sleep-alarm.js';
import { FURNITURE_TYPES_PL, furnitureActionPl, furnitureReasonPl } from '@deadzone/content';
import type {
  ContainerView,
  FurnitureReason,
  ItemId,
  ItemView,
  UtilitiesView,
} from '@deadzone/protocol';
import type { GameState } from '../../state/game-state.js';
import type { HudContentIndex } from '../content-index.js';
import { craftItemName, skillName } from '../crafting-labels.js';
import { formatKg } from '../inventory-model.js';
import { containerName, humanizeId } from '../labels.js';
import {
  DEFAULT_SLEEP_SETTINGS,
  type HudSleepSettings,
  type SleepSurface,
} from '../sleep-settings.js';
import {
  FURNITURE_FEATURES,
  hiddenByFeature,
  type FurnitureActionView,
  type FurnitureFeature,
  type FurnitureView,
} from './furniture-api.js';
import type { FurnIcon } from './furniture-icons.js';
import { waterTankLine } from './water-tank.js';

const TYPE_ICONS: [RegExp, FurnIcon][] = [
  [/fridge|freezer/, 'fridge'],
  [/bed$/, 'bed'],
  [/sofa|couch/, 'sofa'],
  [/(^|:)tv$|television/, 'tv'],
  [/radio/, 'radio'],
  [/stove|oven|range/, 'stove'],
  [/door|gate/, 'door'],
  [/window/, 'window'],
  [/light-switch|switch/, 'switch'],
  [/bath|sink|tap|shower|toilet/, 'water'],
];

const lookup = (t: Readonly<Record<string, string>>, k: string): string | undefined => t[k];

/**
 * Display name: the type name from content (`FURNITURE_TYPES_PL`: Drzwi, Okno, Lodówka, …), else
 * the map object's item / container name, else the id humanised.
 */
export function furnitureName(typeId: string, contentId?: string): string {
  const typed = typeId !== 'other' ? lookup(FURNITURE_TYPES_PL, typeId) : undefined;
  if (typed) return typed;
  if (contentId) {
    const c = containerName(contentId, 'world');
    if (c !== humanizeId(contentId)) return c;
    return craftItemName(contentId);
  }
  return lookup(FURNITURE_TYPES_PL, typeId) ?? humanizeId(typeId);
}

export const furnitureIcon = (typeId: string): FurnIcon =>
  TYPE_ICONS.find(([re]) => re.test(typeId))?.[1] ?? 'box';

const ACTION_ICONS: [RegExp, FurnIcon][] = [
  [/^stop|cancel/, 'stop'],
  // Push / pull / rotate (protocol 38): away from / towards the player, the floor tile it turns on.
  [/^push$/, 'arrowUp'],
  [/^pull$/, 'arrowDown'],
  [/^rotate$/, 'floor'],
  [/curtain/, 'window'],
  [/^light-/, 'switch'],
  [/freez/, 'snow'],
  [/take|loot|grab/, 'hand'],
  [/lockpick|-key$|^unlock$/, 'key'],
  [/^lock$|barricade/, 'lock'],
  [/force|smash|clear-glass/, 'tool'],
  [/knock/, 'hand'],
  [/climb/, 'walk'],
  [/open|close|search|storage/, 'box'],
  [/sleep/, 'moon'],
  [/rest|sit/, 'sofa'],
  [/tape|vhs/, 'tape'],
  [/watch|look/, 'eye'],
  [/radio|listen/, 'radio'],
  [/cook|burner|oven/, 'flame'],
  [/turn|switch|power|light/, 'power'],
  [/wash|drink|fill|water|bath|shower/, 'water'],
  [/clean|dismantle|repair/, 'tool'],
];

export const actionIcon = (id: string): FurnIcon =>
  ACTION_ICONS.find(([re]) => re.test(id))?.[1] ?? 'dot';

/**
 * Icon of each `reason` code (spec „Realizm…”, „Kody `reason` i etykiety”); the texts come from
 * the sim (`reasonPl`) or `FURNITURE_REASONS_PL`.
 */
export const REASON_ICONS: Readonly<Record<FurnitureReason, FurnIcon>> = {
  'no-power': 'bolt',
  'no-water': 'water',
  'no-gas': 'flame',
  threat: 'zombie',
  'too-heavy': 'weight',
  locked: 'lock',
  'no-key': 'key',
  'missing-tool': 'tool',
  'missing-item': 'empty',
  'missing-parts': 'empty',
  'invalid-state': 'ban',
  blocked: 'ban',
  'out-of-range': 'walk',
  busy: 'clock',
  tired: 'moon',
  'not-tired': 'moon',
  fixed: 'lock',
  'wrong-side': 'walk',
  'no-space': 'ban',
  wall: 'ban',
};

/** Icon of a `reason` code (disabled rows). */
export const reasonIcon = (reason: string | undefined): FurnIcon =>
  (reason && Object.hasOwn(REASON_ICONS, reason)
    ? REASON_ICONS[reason as FurnitureReason]
    : undefined) ?? 'ban';

/** Red text of a disabled row: the sim's `reasonPl`, else the content text of the code. */
export const reasonText = (a: {
  reason?: string | undefined;
  reasonPl?: string | undefined;
}): string =>
  a.reasonPl ?? (a.reason ? furnitureReasonPl(a.reason) : furnitureReasonPl('invalid-state'));

/** „1,5 s” below a minute, „15 min”, „1 h 20 min” (spec). */
export function durationLabel(min: number): string {
  if (min < 1) {
    const sec = Math.round(min * 600) / 10;
    return `${String(sec).replace('.', ',')} s`;
  }
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Real seconds under which an action shows its real time (`durationSec`), not game minutes. */
const REAL_TIME_MAX_SEC = 60;

/**
 * Duration of a furniture action: short actions (doors, windows, lockpick, storage) in real
 * seconds at ×1 from the sim's `durationSec` („1,5 s”); long ones (TV, sleep) in game time from
 * `durationMin` („30 min”, „8 h”). Never `durationMin` × 60 — those are game seconds (24× too long).
 */
export function actionDurationLabel(
  a: Pick<FurnitureActionView, 'durationMin' | 'durationSec'>,
): string {
  if (a.durationSec !== undefined && a.durationSec < REAL_TIME_MAX_SEC)
    return `${String(Math.round(a.durationSec * 10) / 10).replace('.', ',')} s`;
  return a.durationMin !== undefined ? durationLabel(a.durationMin) : '';
}

const metres = (d: number): string => `${d.toFixed(1).replace('.', ',')} m`;

export interface FurnPill {
  icon: FurnIcon;
  text: string;
  tone: 'bad' | 'acc' | 'muted';
}

/** Extra info of an enabled row: chance (muted), break / injury chance and noise (yellow). */
export interface FurnExtra {
  text: string;
  tone: 'muted' | 'warn';
}

/** A submenu entry: one `<action>:<itemId>` of a group (lockpick, VHS tape, …). */
export interface FurnSubRowVM {
  actionId: string;
  label: string;
  detail: string;
  /** Item content id for the icon. */
  def?: string;
  enabled: boolean;
  why?: string;
  watched?: boolean;
}

export interface FurnRowVM {
  id: string;
  label: string;
  icon: FurnIcon;
  enabled: boolean;
  /** Extras before the duration (enabled rows only). */
  extras: FurnExtra[];
  /** Right column: duration / submenu count (enabled) or the red reason (disabled). */
  right: string;
  reasonIcon?: FurnIcon;
  /** Opens a submenu (→) with these entries. */
  submenu: boolean;
  children?: FurnSubRowVM[];
  /** Submenu title (KASETY VHS …). */
  subTitle?: string;
  subNote?: string;
}

export interface FurnMenuVM {
  title: string;
  typeId: string;
  icon: FurnIcon;
  dist?: string;
  /** „Woda: 7/10 l, brudna” under the name (`view.waterTank`, protocol 36). */
  tank?: string;
  pills: FurnPill[];
  rows: FurnRowVM[];
}

/** Actions that open a confirmation window first (sleep choice) instead of running at once. */
export const DIALOG_ACTIONS: ReadonlySet<string> = new Set(['sleep']);
/** Group (submenu) of VHS tapes. */
export const TAPE_GROUP = 'insert-tape';
/** Group (submenu) of stove recipes (`cook:<recipeId>`, protocol 31). */
export const COOK_GROUP = 'cook';
/** Types that need mains power / water: the header says when it is off. */
const NEEDS_POWER = /fridge|freezer|(^|:)tv$|radio|light|switch|microwave|oven|range|stove/;
const NEEDS_WATER = /bath|sink|shower|toilet|tap|basin/;

export interface MenuContext {
  state: GameState;
  content: HudContentIndex;
  player?: { x: number; y: number } | undefined;
  features?: Readonly<Record<FurnitureFeature, boolean>>;
  /** VHS tapes watched (submenu „obejrzane · bez XP”). */
  watched?: ReadonlySet<string>;
}

export function extrasOf(a: FurnitureActionView): FurnExtra[] {
  const out: FurnExtra[] = [];
  if (a.chancePct !== undefined)
    out.push({ text: `szansa ${Math.round(a.chancePct)}%`, tone: 'muted' });
  if (a.breakChancePct !== undefined)
    out.push({ text: `złamanie ${Math.round(a.breakChancePct)}%`, tone: 'warn' });
  if (a.injuryChancePct !== undefined)
    out.push({ text: `zranienie ${Math.round(a.injuryChancePct)}%`, tone: 'warn' });
  if (a.noiseTiles !== undefined)
    out.push({ text: `hałas ${Math.round(a.noiseTiles)} m`, tone: 'warn' });
  return out;
}

function rowOf(a: FurnitureActionView): FurnRowVM {
  return {
    id: a.id,
    label: a.labelPl,
    icon: actionIcon(a.id),
    enabled: a.enabled,
    extras: a.enabled ? extrasOf(a) : [],
    right: a.enabled ? actionDurationLabel(a) : reasonText(a),
    ...(!a.enabled ? { reasonIcon: reasonIcon(a.reason) } : {}),
    submenu: false,
  };
}

/** Label of a group row: content text of the prefix (`FURNITURE_ACTIONS_PL`), else the sim's label. */
function groupLabel(prefix: string, first: FurnitureActionView): string {
  const pl = furnitureActionPl(prefix);
  if (pl !== prefix) return pl;
  return first.labelPl.includes(':') ? humanizeId(prefix) : first.labelPl;
}

/**
 * Context menu model: header (name, distance from `x`/`y`, `typeId`), state pills (utilities,
 * locked, fatigue, threat), rows. Feature-gated actions are dropped; actions that use a carried
 * item (`<action>:<itemId>` with `item`) are grouped into one row with a submenu.
 */
export function furnitureMenuVM(
  view: FurnitureView,
  ctx: MenuContext & { utilities?: UtilitiesView | undefined },
): FurnMenuVM {
  const features = ctx.features ?? FURNITURE_FEATURES;
  const actions = view.actions.filter(
    (a) =>
      !isAlarmAction(a.id) &&
      !hiddenByFeature(a.id, features) &&
      !hiddenByFeature(a.labelPl, features),
  );
  const rows: FurnRowVM[] = [];
  const groups = new Map<string, { row: FurnRowVM; acts: FurnitureActionView[] }>();
  for (const a of actions) {
    const colon = a.id.indexOf(':');
    if (colon <= 0 || (!a.item && a.id.slice(0, colon) !== COOK_GROUP)) {
      rows.push(rowOf(a));
      continue;
    }
    const prefix = a.id.slice(0, colon);
    let g = groups.get(prefix);
    if (!g) {
      const label = groupLabel(prefix, a);
      const tapes = prefix === TAPE_GROUP;
      g = {
        row: {
          id: prefix,
          label,
          icon: actionIcon(prefix),
          enabled: false,
          extras: [],
          right: '',
          submenu: false,
          children: [],
          subTitle: tapes ? 'KASETY VHS' : label.toUpperCase(),
          ...(tapes ? { subNote: 'Kaseta wchodzi bez prądu · odtwarzanie po włączeniu' } : {}),
        },
        acts: [],
      };
      groups.set(prefix, g);
      rows.push(g.row);
    }
    g.acts.push(a);
    g.row.children!.push(subRowOf(a, prefix, ctx));
  }
  for (const { row, acts } of groups.values()) {
    const kids = row.children!;
    const firstOn = acts.find((a) => a.enabled);
    row.enabled = !!firstOn;
    row.submenu = row.enabled;
    if (firstOn) {
      // Odds are the same for every tool of a group (lockpicks): shown on the row too.
      row.extras = row.id === TAPE_GROUP ? [] : extrasOf(firstOn);
      const n = kids.filter((k) => k.enabled).length;
      row.right = row.id === TAPE_GROUP ? `${n} w ekwipunku ›` : `${n} ›`;
    } else {
      row.right = kids[0]?.why ?? '';
      row.reasonIcon = reasonIcon(acts[0]?.reason);
    }
  }
  const p = ctx.player;
  return {
    title: furnitureName(view.typeId, view.contentId),
    typeId: view.typeId,
    icon: furnitureIcon(view.contentId && view.typeId === 'other' ? view.contentId : view.typeId),
    ...(p ? { dist: metres(Math.hypot(view.x - p.x, view.y - p.y)) } : {}),
    ...(view.waterTank ? { tank: waterTankLine(view.waterTank) } : {}),
    pills: menuPills(view, actions, ctx),
    rows,
  };
}

function subRowOf(a: FurnitureActionView, prefix: string, ctx: MenuContext): FurnSubRowVM {
  const def = a.item?.def;
  let detail: string;
  let watched = false;
  if (prefix === TAPE_GROUP && def) {
    const t = tapeDetail(def, ctx.content, ctx.watched ?? new Set());
    detail = t.detail;
    watched = t.watched;
    if (a.enabled) detail = [detail, actionDurationLabel(a)].filter(Boolean).join(' · ');
  } else if (prefix === COOK_GROUP) {
    return cookSubRow(a, ctx);
  } else {
    const parts = extrasOf(a).map((e) => e.text);
    const dur = actionDurationLabel(a);
    if (dur) parts.push(dur);
    detail = parts.join(' · ');
  }
  return {
    actionId: a.id,
    label: def ? craftItemName(def) : a.labelPl,
    detail: a.enabled ? detail : '',
    ...(def ? { def } : {}),
    enabled: a.enabled,
    ...(!a.enabled ? { why: reasonText(a) } : {}),
    ...(prefix === TAPE_GROUP ? { watched } : {}),
  };
}

/**
 * Stove recipe row: the sim's dish label and `recipe` (protocol 34), the burn chance with the
 * current cooking skill (`crafting.recipes[].burnChance`, protocol 31) and the time.
 */
function cookSubRow(a: FurnitureActionView, ctx: MenuContext): FurnSubRowVM {
  const burn = a.recipe
    ? ctx.state.crafting?.recipes.find((r) => r.id === a.recipe)?.burnChance
    : undefined;
  const parts: string[] = [];
  if (burn !== undefined && burn > 0) parts.push(`przypalenie ${Math.round(burn * 100)}%`);
  const dur = actionDurationLabel(a);
  if (dur) parts.push(dur);
  return {
    actionId: a.id,
    label: a.labelPl,
    detail: a.enabled ? parts.join(' · ') : '',
    enabled: a.enabled,
    ...(!a.enabled ? { why: reasonText(a) } : {}),
  };
}

function menuPills(
  view: FurnitureView,
  actions: readonly FurnitureActionView[],
  ctx: MenuContext & { utilities?: UtilitiesView | undefined },
): FurnPill[] {
  const pills: FurnPill[] = [];
  const reasons = new Set(actions.map((a) => a.reason));
  const kind = `${view.typeId} ${view.contentId ?? ''}`;
  const u = ctx.utilities;
  if (reasons.has('no-power') || (u && !u.power && !u.powerSource && NEEDS_POWER.test(kind)))
    pills.push({ icon: 'bolt', text: 'BRAK PRĄDU', tone: 'bad' });
  // A tank with water left still works with the mains off (toilet cistern, protocol 36).
  const tankLeft = (view.waterTank?.litres ?? 0) > 0;
  // An empty tank already says „Pusty zbiornik” on its rows; the pill is for taps with the mains cut.
  if (
    !view.waterTank &&
    (reasons.has('no-water') || (u && !u.water && !tankLeft && NEEDS_WATER.test(kind)))
  )
    pills.push({ icon: 'water', text: 'BRAK WODY', tone: 'bad' });
  if (reasons.has('locked') || actions.some((a) => /^unlock|^lockpick/.test(a.id)))
    pills.push({ icon: 'lock', text: 'ZAMKNIĘTE', tone: 'muted' });
  if (actions.some((a) => a.id === 'sleep' || a.id === 'rest')) {
    const f = Math.round(ctx.state.player.stats.fatigue ?? 0);
    pills.push({ icon: 'moon', text: `ZMĘCZENIE ${f}`, tone: 'acc' });
  }
  if (reasons.has('threat')) pills.push({ icon: 'zombie', text: 'ZAGROŻENIE', tone: 'bad' });
  return pills;
}

/** Next enabled row after `from` in direction `dir` (wraps; −1 when none is enabled). */
export function stepSelection(
  rows: readonly { enabled: boolean }[],
  from: number,
  dir: 1 | -1,
): number {
  const n = rows.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (rows[i]!.enabled) return i;
  }
  return -1;
}

/** „Gotowanie +75 XP” or „obejrzane · bez XP” (tapes watched this session, see controller). */
export function tapeDetail(
  def: string,
  content: HudContentIndex,
  watched: ReadonlySet<string>,
): { detail: string; watched: boolean } {
  const vhs = content.items.get(def)?.vhs;
  const isWatched = watched.has(def) && (vhs?.once ?? true);
  const detail = isWatched
    ? 'obejrzane · bez XP'
    : (vhs?.skills ?? []).map((k) => `${skillName(k.skill)} +${k.xp} XP`).join(' · ');
  return { detail, watched: isWatched };
}

// ── Fridge window ────────────────────────────────────────────────────────────

export interface FridgeRowVM {
  id: ItemId;
  def: string;
  name: string;
  count: number;
  weight: string;
  /** 0..1 bar, label, tone (`ice` = frozen / thawing). */
  fresh?: { pct: number; label: string; tone: 'ok' | 'warn' | 'bad' | 'ice' };
}

export interface FridgeVM {
  title: string;
  dist?: string;
  /** Section title (CHŁODZIARKA / ZAMRAŻARKA). */
  section: string;
  capacity: { used: number; max: number | null; label: string };
  /** Header pills (no power when the sim says so; generator / thaw timer are feature-gated). */
  pills: FurnPill[];
  rows: FridgeRowVM[];
  rotten: ItemId[];
  /** Tooltip line: spoilage now vs with power. */
  spoilNote: string;
}

const FRESH: Record<NonNullable<ItemView['freshness']>, NonNullable<FridgeRowVM['fresh']>> = {
  fresh: { pct: 0.9, label: 'Świeże', tone: 'ok' },
  stale: { pct: 0.4, label: 'Nieświeże', tone: 'warn' },
  rotten: { pct: 0.08, label: 'Zepsute', tone: 'bad' },
};

/**
 * Freshness column: frozen (protocol 25) wins — „Zamrożone”, or „Rozmraża się · 40 min” while
 * `thawMin` runs — then the spoilage state.
 */
export function freshOf(
  it: Pick<ItemView, 'freshness' | 'frozen' | 'thawMin'>,
): FridgeRowVM['fresh'] {
  if (it.thawMin !== undefined && it.thawMin > 0)
    return { pct: 0.6, label: `Rozmraża się · ${durationLabel(it.thawMin)}`, tone: 'ice' };
  if (it.frozen) return { pct: 1, label: 'Zamrożone', tone: 'ice' };
  return it.freshness ? FRESH[it.freshness] : undefined;
}

/** `base:fridge` 0.3 / `base:freezer` 0.05 (containers/household.json). */
const SPOIL: Record<string, number> = {
  'base:fridge': 0.3,
  'base:fridge-freezer': 0.3,
  'base:freezer': 0.05,
};

export function fridgeVM(
  c: ContainerView,
  opts: { power?: boolean | undefined; player?: { x: number; y: number } | undefined },
): FridgeVM {
  const freezer = c.type === 'base:freezer';
  const rows = c.items.map((it): FridgeRowVM => ({
    id: it.id,
    def: it.def,
    name: craftItemName(it.def),
    count: it.count,
    weight: formatKg(it.weightKg),
    ...(freshOf(it) ? { fresh: freshOf(it)! } : {}),
  }));
  const pills: FurnPill[] = [];
  if (opts.power === false) pills.push({ icon: 'bolt', text: 'BRAK PRĄDU', tone: 'bad' });
  const mult = SPOIL[c.type ?? ''] ?? 1;
  const p = opts.player;
  return {
    title: furnitureName(freezer ? 'freezer' : 'fridge', c.type),
    ...(p && c.x !== undefined && c.y !== undefined
      ? { dist: metres(Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y)) }
      : {}),
    section: freezer ? 'ZAMRAŻARKA' : 'CHŁODZIARKA',
    capacity: {
      used: c.weightKg,
      max: c.capacityKg,
      label: `${formatKg(c.weightKg)} / ${c.capacityKg === null ? '∞' : formatKg(c.capacityKg)} kg`,
    },
    pills,
    rows,
    rotten: c.items.filter((i) => i.freshness === 'rotten').map((i) => i.id),
    spoilNote:
      opts.power === false
        ? `Psucie teraz ×1,0 / z prądem ×${String(mult).replace('.', ',')}`
        : `Psucie ×${String(mult).replace('.', ',')} (z prądem)`,
  };
}

// ── Watching (TV / VHS) ──────────────────────────────────────────────────────

export interface WatchVM {
  /** „OGLĄDANIE · KANAPA”. */
  kicker: string;
  title: string;
  /** Elapsed / total, m:ss of real time at ×1. */
  elapsed: string;
  total: string;
  pct: number;
  skills: { name: string; level?: number; xp: string; pct: number }[];
  note: string;
  effects: { label: string; value: string; icon: FurnIcon; up: boolean }[];
}

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function watchVM(
  s: GameState,
  content: HudContentIndex,
  o: { tick: number; tickMs: number; surface: SleepSurface; watched: ReadonlySet<string> },
): WatchVM | undefined {
  const a = s.action;
  if (a?.kind !== 'watch') return undefined;
  const cfg: HudSleepSettings = content.sleep ?? DEFAULT_SLEEP_SETTINGS;
  const span = Math.max(1, a.endTick - a.startTick);
  const pct = Math.min(1, Math.max(0, (o.tick - a.startTick) / span));
  const tape = a.item !== undefined ? findItem(s, a.item) : undefined;
  const vhs = tape ? content.items.get(tape.def)?.vhs : undefined;
  const fx = vhs ? cfg.leisure.vhs : cfg.leisure.tv;
  const watched = !!tape && o.watched.has(tape.def) && (vhs?.once ?? true);
  const place = o.surface === 'floor' ? 'TELEWIZOR' : o.surface === 'bed' ? 'ŁÓŻKO' : 'KANAPA';
  return {
    kicker: `OGLĄDANIE · ${place}`,
    title: tape ? craftItemName(tape.def) : 'Telewizja',
    elapsed: mmss(pct * span * o.tickMs),
    total: mmss(span * o.tickMs),
    pct,
    skills: (vhs?.skills ?? []).map((k) => {
      const sk = s.skills.find((x) => x.id === k.skill);
      const pctSk = sk && sk.next ? Math.min(1, sk.xp / sk.next) : 0;
      return {
        name: skillName(k.skill),
        ...(sk ? { level: sk.level } : {}),
        xp: watched ? 'bez XP' : `+${k.xp} XP`,
        pct: pctSk,
      };
    }),
    note: vhs
      ? watched
        ? 'obejrzana wcześniej · bez XP'
        : 'XP po obejrzeniu do końca · raz na postać'
      : `sesja ${cfg.leisure.tv.sessionMin} min`,
    effects: [
      { label: 'Odpoczynek', value: `+${fx.rest}`, icon: 'sofa', up: true },
      { label: 'Nuda', value: `−${fx.boredom}`, icon: 'eye', up: false },
      { label: 'Stres', value: `−${fx.stress}`, icon: 'pulse', up: false },
    ],
  };
}

function findItem(s: GameState, id: ItemId): ItemView | undefined {
  for (const c of Object.values(s.inventory?.containers ?? {})) {
    const it = c.items.find((i) => i.id === id);
    if (it) return it;
  }
  return undefined;
}

// ── Sleep choice ─────────────────────────────────────────────────────────────

export interface SleepCardVM {
  surface: SleepSurface;
  name: string;
  /** „TERAZ”, „w pobliżu”, „zawsze”, „brak”. */
  note: string;
  quality: number;
  cap: number;
  current: boolean;
  available: boolean;
}

export interface SleepChoiceVM {
  title: string;
  now: string;
  cards: SleepCardVM[];
  rows: { label: string; value: string; icon: FurnIcon; tone?: 'acc' | 'bad' }[];
  /** Alarm choice (`sleep` / `sleep-until:*`); one is selected. */
  alarms: { id: string; label: string; selected: boolean }[];
  /** Red blocked state (button disabled). */
  blocked?: string;
  blockedNote?: string;
  canSleep: boolean;
}

/** Bed / sofa names from content (`FURNITURE_TYPES_PL`); the floor is not furniture. */
const SURFACE_NAME: Record<SleepSurface, string> = {
  bed: FURNITURE_TYPES_PL.bed,
  sofa: FURNITURE_TYPES_PL.sofa,
  floor: 'Podłoga',
};

const hhmm = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Sleep window: quality cards from `sleep.surfaces` (bed 100 %, sofa 75 %, floor 50 % of the bed
 * rate), the expected fatigue / wake-up time and the blocked state. The sim picks the best surface
 * within 1.5 tiles; `here` is that one.
 */
export function sleepChoiceVM(
  s: GameState,
  cfg: HudSleepSettings,
  o: {
    here: SleepSurface;
    nearby: ReadonlySet<SleepSurface>;
    /** The action as the sim sent it (enabled / reason). */
    action?: { enabled: boolean; reasonPl?: string | undefined } | undefined;
    /** Alarm choices (`alarmOptions`) and the selected id. */
    alarms?: readonly AlarmOption[];
    alarm?: string;
  },
): SleepChoiceVM {
  const alarms = o.alarms ?? [];
  const picked = alarms.find((a) => a.id === o.alarm) ?? alarms[0];
  const bedRate = cfg.surfaces.bed.ratePerMin || 1;
  const cards = (['bed', 'sofa', 'floor'] as const).map((k): SleepCardVM => {
    const available = k === 'floor' || o.nearby.has(k);
    return {
      surface: k,
      name: SURFACE_NAME[k],
      note: k === o.here ? 'TERAZ' : k === 'floor' ? 'zawsze' : available ? 'w pobliżu' : 'brak',
      quality: cfg.surfaces[k].ratePerMin / bedRate,
      cap: cfg.surfaces[k].cap,
      current: k === o.here,
      available,
    };
  });
  const fatigue = Math.round(s.player.stats.fatigue ?? 0);
  const surf = cfg.surfaces[o.here];
  const target = Math.max(cfg.wakeAtFatigue, fatigue - surf.cap);
  const mins = Math.min(cfg.maxDurationMin, (fatigue - target) / Math.max(1e-6, surf.ratePerMin));
  const clock = s.clock;
  const wakeMin = picked?.hours !== undefined ? picked.hours * 60 : mins;
  const wakeAt = clock && !picked?.morning ? clock.minuteOfDay + wakeMin : undefined;
  const wakeDay = clock && wakeAt !== undefined ? clock.day + Math.floor(wakeAt / 1440) : undefined;
  const saveMin = Math.floor(cfg.saveAfterRealSec / 60);
  const saveSec = String(cfg.saveAfterRealSec % 60).padStart(2, '0');
  const rows: SleepChoiceVM['rows'] = [
    { label: 'Zmęczenie', value: `${fatigue} → ${Math.round(target)}`, icon: 'moon', tone: 'acc' },
    ...(wakeAt !== undefined
      ? [
          {
            label: picked?.hours !== undefined ? 'Budzik' : 'Pobudka (szac.)',
            value: `${hhmm(wakeAt)} · dzień ${wakeDay}`,
            icon: 'clock' as const,
          },
        ]
      : picked?.morning
        ? [
            {
              label: 'Budzik',
              value: `${hhmm(cfg.morningHour * 60)} · rano`,
              icon: 'clock' as const,
            },
          ]
        : []),
    { label: 'Zapis gry', value: `po ${saveMin}:${saveSec} nieprzerwanego snu`, icon: 'save' },
  ];
  let blocked: string | undefined;
  let blockedNote: string | undefined;
  if (s.threat > 0) {
    blocked = 'Nie możesz spać · zombie w pobliżu';
    blockedNote = `Przycisk ŚPIJ wyszarzony, dopóki zombie jest bliżej niż ${cfg.wakeOnZombieTiles} m`;
  } else if (fatigue < cfg.minFatigueToSleep) {
    blocked = `Nie możesz spać · zmęczenie ${fatigue}`;
    blockedNote = `Sen od zmęczenia ${cfg.minFatigueToSleep}`;
  } else if (o.action && !o.action.enabled) {
    blocked = `Nie możesz spać · ${o.action.reasonPl ?? 'niedostępne'}`;
  }
  return {
    title: `ŚPIJ · ${SURFACE_NAME[o.here].toUpperCase()}`,
    now: clock ? `${hhmm(clock.minuteOfDay)} · dzień ${clock.day}` : '',
    cards,
    rows,
    alarms: alarms.map((a) => ({ id: a.id, label: a.label, selected: a === picked })),
    ...(blocked ? { blocked } : {}),
    ...(blockedNote ? { blockedNote } : {}),
    canSleep: !blocked,
  };
}
