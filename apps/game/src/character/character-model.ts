import type { BodyPart, SimEvent, WoundKind, WoundView } from '@deadzone/protocol';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from '../hud/content-index.js';
import { professionName, skillName, traitName } from '../creator/creator-labels.js';
import { displayName } from '../characters/display-name.js';
import { recipeName } from '../hud/crafting-labels.js';

/** Tabs of the character window: H, K and J open it at their tab. */
export type CharacterTab = 'character' | 'skills' | 'journal';

export const CHARACTER_TABS: readonly { id: CharacterTab; label: string; key: string }[] = [
  { id: 'character', label: 'Postać', key: 'H' },
  { id: 'skills', label: 'Umiejętności', key: 'K' },
  { id: 'journal', label: 'Dziennik', key: 'J' },
];

export const BODY_PART_LABELS: Record<BodyPart, string> = {
  head: 'Głowa',
  neck: 'Szyja',
  torso_upper: 'Klatka piersiowa',
  torso_lower: 'Brzuch',
  groin: 'Pachwina',
  upper_arm_l: 'Lewe ramię',
  upper_arm_r: 'Prawe ramię',
  forearm_l: 'Lewe przedramię',
  forearm_r: 'Prawe przedramię',
  hand_l: 'Lewa dłoń',
  hand_r: 'Prawa dłoń',
  thigh_l: 'Lewe udo',
  thigh_r: 'Prawe udo',
  shin_l: 'Lewa goleń',
  shin_r: 'Prawa goleń',
  foot_l: 'Lewa stopa',
  foot_r: 'Prawa stopa',
};

export const WOUND_LABELS: Record<WoundKind, string> = {
  scratch: 'Zadrapanie',
  laceration: 'Rana cięta',
  bite: 'Ugryzienie',
  deep: 'Głęboka rana',
};

/** Content defaults of `wounds.stitch` / `wounds.disinfect` (content schema wound-care.ts). */
const STITCH_KINDS: readonly WoundKind[] = ['laceration', 'bite', 'deep'];
const NEEDLE_TAG = 'base:tool-needle';
const THREAD_TAG = 'base:thread';
const DISINFECT_LIQUID_TAG = 'base:disinfectant-liquid';

/** Skill groups (content `skills/*.json`, field `group`), in display order. */
const SKILL_GROUPS: readonly { id: string; label: string; skills: readonly string[] }[] = [
  {
    id: 'combat',
    label: 'Walka',
    skills: [
      'base:blunt',
      'base:blade-long',
      'base:blade-short',
      'base:spear',
      'base:aiming',
      'base:reloading',
    ],
  },
  {
    id: 'survival',
    label: 'Przetrwanie',
    skills: [
      'base:first-aid',
      'base:cooking',
      'base:farming',
      'base:foraging',
      'base:fishing',
      'base:trapping',
    ],
  },
  {
    id: 'crafting',
    label: 'Rzemiosło',
    skills: [
      'base:carpentry',
      'base:mechanics',
      'base:electrical',
      'base:tailoring',
      'base:metalworking',
    ],
  },
  {
    id: 'movement',
    label: 'Ruch',
    skills: [
      'base:sprinting',
      'base:nimble',
      'base:sneaking',
      'base:lightfoot',
      'base:strength',
      'base:fitness',
    ],
  },
];

/** Skills top out at level 10 (content `maxLevel`). */
export const SKILL_MAX_LEVEL = 10;

export interface StatRowVM {
  id: string;
  label: string;
  /** 0..100. */
  value: number;
  /** Higher is worse (hunger, pain …): the bar turns red when high. */
  bad: boolean;
  /** Worth a warning colour now. */
  warn: boolean;
}

export type WoundAction = 'bandage' | 'disinfect' | 'stitch';

export interface WoundRowVM {
  part: BodyPart;
  partLabel: string;
  /** `Rana cięta, Zadrapanie`. */
  wounds: string;
  bleeding: number;
  /** 0..100. */
  healedPct: number;
  /** Short state words: opatrzona, brudny opatrunek, zakażona, zszyta, odkażona. */
  flags: string[];
  infected: boolean;
  /** Treatments that make sense now, with whether the needed items are carried. */
  actions: { id: WoundAction; label: string; ready: boolean; missing?: string }[];
}

export interface CharacterVM {
  name: string;
  profession: string;
  day?: number;
  kills: number;
  stats: StatRowVM[];
  temperatureC?: number;
  weightKg?: number;
  traits: { id: string; name: string }[];
  wounds: WoundRowVM[];
}

/** Stats shown on the character tab: [id, label, higher is worse, warn threshold]. */
const STAT_ROWS: readonly [string, string, boolean, number][] = [
  ['health', 'Zdrowie', false, 50],
  ['hunger', 'Głód', true, 60],
  ['thirst', 'Pragnienie', true, 60],
  ['fatigue', 'Zmęczenie', true, 70],
  ['endurance', 'Kondycja', false, 30],
  ['pain', 'Ból', true, 40],
  ['stress', 'Stres', true, 60],
  ['boredom', 'Nuda', true, 60],
  ['unhappiness', 'Smutek', true, 60],
  ['sickness', 'Choroba', true, 30],
  ['wetness', 'Przemoczenie', true, 50],
];

/** What the player carries for wound care (by content effects and tags). */
export function woundSupplies(
  s: GameState,
  content: HudContentIndex,
): { bandage?: number; disinfect: boolean; needle: boolean; thread: boolean } {
  let bandage: number | undefined;
  let disinfect = false;
  let needle = false;
  let thread = false;
  for (const c of Object.values(s.inventory?.containers ?? {})) {
    for (const it of c.items) {
      const def = content.items.get(it.def);
      if (!def) continue;
      const fx = def.medical ?? [];
      const tags = def.tags ?? [];
      if (bandage === undefined && fx.includes('stop_bleeding')) bandage = it.id;
      if (fx.includes('disinfect') || tags.includes(DISINFECT_LIQUID_TAG)) disinfect = true;
      if (tags.includes(NEEDLE_TAG)) needle = true;
      if (tags.includes(THREAD_TAG)) thread = true;
    }
  }
  return { ...(bandage !== undefined ? { bandage } : {}), disinfect, needle, thread };
}

function woundRows(
  wounds: readonly WoundView[],
  supplies: ReturnType<typeof woundSupplies>,
): WoundRowVM[] {
  const byPart = new Map<BodyPart, WoundView[]>();
  for (const w of wounds) byPart.set(w.part, [...(byPart.get(w.part) ?? []), w]);
  const rows: WoundRowVM[] = [];
  for (const [part, list] of byPart) {
    const bleeding = list.reduce((n, w) => n + w.bleeding, 0);
    const healed = Math.min(...list.map((w) => w.healed));
    const bandaged = list.every((w) => w.bandaged);
    const dirty = list.some((w) => w.bandaged && w.bandageDirty);
    const infected = list.some((w) => w.infected);
    const stitched = list.every((w) => w.stitched);
    const disinfected = list.every((w) => w.disinfected);
    const flags: string[] = [];
    if (bandaged) flags.push(dirty ? 'brudny opatrunek' : 'opatrzona');
    if (infected) flags.push('zakażona');
    if (stitched) flags.push('zszyta');
    if (disinfected && !infected) flags.push('odkażona');
    const actions: WoundRowVM['actions'] = [];
    if (!bandaged || dirty) {
      actions.push({
        id: 'bandage',
        label: dirty ? 'Zmień opatrunek' : 'Opatrz',
        ready: supplies.bandage !== undefined,
        ...(supplies.bandage === undefined ? { missing: 'Potrzebny bandaż' } : {}),
      });
    }
    if (infected || !disinfected) {
      actions.push({
        id: 'disinfect',
        label: 'Odkaź',
        ready: supplies.disinfect,
        ...(supplies.disinfect ? {} : { missing: 'Potrzebny środek odkażający' }),
      });
    }
    if (list.some((w) => !w.stitched && w.healed < 1 && STITCH_KINDS.includes(w.wound))) {
      const ready = supplies.needle && supplies.thread;
      actions.push({
        id: 'stitch',
        label: 'Zszyj',
        ready,
        ...(ready ? {} : { missing: supplies.needle ? 'Potrzebna nić' : 'Potrzebna igła i nić' }),
      });
    }
    rows.push({
      part,
      partLabel: BODY_PART_LABELS[part] ?? part,
      wounds: list.map((w) => WOUND_LABELS[w.wound] ?? w.wound).join(', '),
      bleeding: Math.round(bleeding),
      healedPct: Math.round(healed * 100),
      flags,
      infected,
      actions,
    });
  }
  // Worst first: bleeding, then infection.
  return rows.sort((a, b) => b.bleeding - a.bleeding || Number(b.infected) - Number(a.infected));
}

export function characterVM(s: GameState, content: HudContentIndex): CharacterVM {
  const p = s.characterProfile;
  const st = s.player.stats;
  const stats: StatRowVM[] = [];
  for (const [id, label, bad, at] of STAT_ROWS) {
    const v = st[id as keyof typeof st];
    if (v === undefined) continue;
    const value = Math.max(0, Math.min(100, Math.round(v)));
    stats.push({ id, label, value, bad, warn: bad ? value >= at : value <= at });
  }
  const t = st['body-temperature-c'];
  const kg = st['body-weight-kg'];
  return {
    name: p ? displayName(p.firstName, p.lastName) : 'Ocalały',
    profession: p ? professionName(p.profession) : '',
    ...(s.clock ? { day: s.clock.day } : {}),
    kills: s.combat?.zombiesKilled ?? 0,
    stats,
    ...(t !== undefined ? { temperatureC: Math.round(t * 10) / 10 } : {}),
    ...(kg !== undefined ? { weightKg: Math.round(kg * 10) / 10 } : {}),
    traits: [...(p?.traits ?? [])]
      .map((id) => ({ id, name: traitName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    wounds: woundRows(s.player.wounds, woundSupplies(s, content)),
  };
}

export interface SkillRowVM {
  id: string;
  name: string;
  level: number;
  /** Progress to the next level 0..100 (100 at max). */
  pct: number;
  xpText: string;
}

export function skillsVM(s: GameState): { id: string; label: string; skills: SkillRowVM[] }[] {
  const byId = new Map(s.skills.map((k) => [k.id, k]));
  const known = new Set(SKILL_GROUPS.flatMap((g) => g.skills));
  const groups = SKILL_GROUPS.map((g) => ({ id: g.id, label: g.label, ids: g.skills }));
  // Skills from mods the table does not know: an extra group at the end.
  const extra = s.skills.map((k) => k.id).filter((id) => !known.has(id));
  if (extra.length) groups.push({ id: 'other', label: 'Inne', ids: extra.sort() });
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    skills: g.ids.map((id) => {
      const k = byId.get(id);
      const level = k?.level ?? 0;
      const xp = k?.xp ?? 0;
      const next = k ? k.next : 1;
      const pct = next === null ? 100 : next > 0 ? Math.min(100, (xp / next) * 100) : 0;
      return {
        id,
        name: skillName(id),
        level,
        pct: Math.round(pct),
        xpText: next === null ? 'maks.' : `${Math.floor(xp)} / ${next} XP`,
      };
    }),
  }));
}

/** One line of the journal: when and what happened. */
export interface JournalEntry {
  day: number;
  minuteOfDay: number;
  text: string;
}

/** Most entries the journal keeps (oldest drop off). */
export const JOURNAL_MAX = 200;

/** Journal line for a sim event of the local player (undefined = not worth a line). */
export function journalText(e: SimEvent, playerId: number): string | undefined {
  if ('playerId' in e && e.playerId !== playerId) return undefined;
  switch (e.type) {
    case 'characterCreated':
      return `Początek: ${displayName(e.character.firstName, e.character.lastName)}, ${professionName(e.character.profession).toLowerCase()}`;
    case 'skillLevelUp':
      return `${skillName(e.skill)}: poziom ${e.level}`;
    case 'traitChanged':
      return `${e.gained ? 'Nowa cecha' : 'Cecha minęła'}: ${traitName(e.trait)}`;
    case 'recipeLearned':
      return `Nowy przepis: ${recipeName(e.recipe)}`;
    case 'wounded':
      return `${WOUND_LABELS[e.wound] ?? 'Rana'}: ${(BODY_PART_LABELS[e.part] ?? e.part).toLowerCase()}`;
    case 'woundTreated':
      return `${e.treatment === 'stitch' ? (e.success ? 'Zszyłem ranę' : 'Szycie nie wyszło') : 'Odkaziłem ranę'}: ${(BODY_PART_LABELS[e.part] ?? e.part).toLowerCase()}`;
    case 'fished':
      return e.caught ? 'Złowiłem rybę' : 'Łowiłem, ale nic nie wzięło';
    default:
      return undefined;
  }
}

/** Journal of this session (newest first): events worth remembering, with the game time. */
export class Journal {
  private list: JournalEntry[] = [];
  constructor(private readonly playerId: number) {}

  /** Adds the lines for `events` at the given game time; true when anything was added. */
  add(events: readonly SimEvent[], day: number, minuteOfDay: number): boolean {
    let added = false;
    for (const e of events) {
      const text = journalText(e, this.playerId);
      if (!text) continue;
      this.list.unshift({ day, minuteOfDay, text });
      added = true;
    }
    if (this.list.length > JOURNAL_MAX) this.list.length = JOURNAL_MAX;
    return added;
  }

  get entries(): readonly JournalEntry[] {
    return this.list;
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `Dzień 3, 09:05`. */
export const journalTime = (e: JournalEntry): string =>
  `Dzień ${e.day}, ${pad(Math.floor(e.minuteOfDay / 60))}:${pad(e.minuteOfDay % 60)}`;

/** Polish toast for a rejected wound treatment (`treatWound` / `bandage` / `useItem`). */
export function woundRejectText(reason: string): string {
  switch (reason) {
    case 'missing-item':
    case 'no-item':
      return 'Brakuje potrzebnych przedmiotów';
    case 'missing-tool':
      return 'Potrzebna igła';
    case 'invalid-target':
      return 'Tu nie ma czego opatrywać';
    case 'busy':
      return 'Najpierw skończ to, co robisz';
    default:
      return 'Teraz się nie da';
  }
}

/**
 * Part to treat with a medical item used from the inventory: the worst bleeding wound not yet
 * bandaged (or with a dirty bandage), else any wound; undefined without wounds.
 */
export function medicalTargetPart(wounds: readonly WoundView[]): BodyPart | undefined {
  const open = wounds.filter((w) => !w.bandaged || w.bandageDirty);
  const pool = open.length ? open : wounds;
  let best: WoundView | undefined;
  for (const w of pool) if (!best || w.bleeding > best.bleeding) best = w;
  return best?.part;
}
