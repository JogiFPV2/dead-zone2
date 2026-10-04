import type { CharacterSpec } from '@deadzone/protocol';
import { checkCharacter, skillCost, type CharacterCheck, type ContentIndex } from '@deadzone/sim';
import { displayName } from '../characters/display-name.js';
import {
  CLOTH_OPTIONS,
  HEAD_PRESETS,
  clothOption,
  headPreset,
  presetOfParts,
  type ClothSlot,
  type RenderLook,
} from './appearance-map.js';

/** Pure state of the character creator (deadzone-shots/creator-*.png); colors are palette ids. */
export interface ClothChoice {
  part: string;
  primary: string;
  secondary: string;
}

export interface CreatorDraft {
  /** Required (content `characterCreation.name` length). */
  firstName: string;
  /** Optional; when given it follows the same length rule. */
  lastName: string;
  skin: string;
  /** Head preset id (appearance-map HEAD_PRESETS). */
  head: string;
  hairColor: string;
  top: ClothChoice;
  bottom: ClothChoice;
  shoes: ClothChoice;
  profession: string;
  /** Bought levels per skill (on top of starting level and bonuses). */
  skills: Readonly<Record<string, number>>;
  /** Picked selectable traits (profession free traits are added by the sim). */
  traits: readonly string[];
}

type Trait = ContentIndex['traits'] extends ReadonlyMap<string, infer T> ? T : never;
type Profession = ContentIndex['professions'] extends ReadonlyMap<string, infer T> ? T : never;
type Rng = () => number;

export const CLOTH_SLOTS: readonly ClothSlot[] = ['top', 'bottom', 'shoes'];
const DEFAULTS = { startPoints: 8, maxSkillLevelAtStart: 3, skillPointCost: [1, 2, 3] };
export const SKILL_MAX = 10;

export const creation = (c: ContentIndex) =>
  c.characterCreation ?? { ...DEFAULTS, name: { minLen: 2, maxLen: 24 }, skinPalette: 'base:skin' };

const paletteColors = (c: ContentIndex, id: string): readonly { id: string; hex: string }[] =>
  c.palettes.get(id)?.colors ?? [];

export const SKIN_PALETTE = 'base:skin';
export const HAIR_PALETTE = 'base:hair';
export const CLOTH_PALETTE = 'base:cloth';

/** Hex of a palette color (undefined when unknown). */
export function paletteHex(
  c: ContentIndex,
  palette: string,
  color: string | undefined,
): string | undefined {
  if (color === undefined) return undefined;
  return c.palettes.get(palette)?.colors.find((x) => x.id === color)?.hex;
}

/** Color channels a content part can be tinted in (`[]` when the part is unknown). */
export function partChannels(c: ContentIndex, part: string): ('primary' | 'secondary')[] {
  return (c.appearanceParts.get(part)?.tints ?? []).map((t) => t.channel);
}

/** Cloth options that exist in content (the 3D map may know parts a mod removed). */
export function clothOptions(c: ContentIndex, slot: ClothSlot) {
  const list = CLOTH_OPTIONS[slot].filter((o) => c.appearanceParts.has(o.part));
  return list.length ? list : CLOTH_OPTIONS[slot];
}

/** Whether the content uses the merged `head` slot (PR #38) instead of `face` + `hair`. */
export const usesHeadSlot = (c: ContentIndex): boolean =>
  [...c.appearanceParts.values()].some((p) => (p.slot as string) === 'head');

/** Draft from `characterCreation.defaultAppearance` and the first profession. */
export function defaultDraft(c: ContentIndex, name = 'Adam Nowak'): CreatorDraft {
  const def = creation(c).defaultAppearance;
  const parts = (def?.parts ?? {}) as Readonly<
    Record<string, { part: string; colors?: { primary?: string; secondary?: string } }>
  >;
  const cloth = (slot: ClothSlot): ClothChoice => {
    const d = parts[slot];
    const opt = clothOption(slot, d?.part ?? '');
    const first = paletteColors(c, CLOTH_PALETTE)[0]?.id ?? '';
    return {
      part: opt.part,
      primary: d?.colors?.primary ?? first,
      secondary: d?.colors?.secondary ?? d?.colors?.primary ?? first,
    };
  };
  const hairChoice = parts.head ?? parts.hair;
  const preset = presetOfParts(parts);
  const professions = [...c.professions.keys()];
  return {
    ...splitName(name),
    skin: def?.skin ?? paletteColors(c, SKIN_PALETTE)[0]?.id ?? '',
    head: preset.id,
    hairColor: hairChoice?.colors?.primary ?? paletteColors(c, HAIR_PALETTE)[0]?.id ?? '',
    top: cloth('top'),
    bottom: cloth('bottom'),
    shoes: cloth('shoes'),
    profession: professions.includes('base:unemployed')
      ? 'base:unemployed'
      : (professions[0] ?? ''),
    skills: {},
    traits: [],
  };
}

/** `"Adam  Nowak Kowalski"` → first `Adam`, last `Nowak Kowalski`. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export { displayName };

export const draftName = (d: CreatorDraft): string => displayName(d.firstName, d.lastName);

function channelColors(
  c: ContentIndex,
  part: string,
  colors: { primary: string; secondary?: string },
): { primary?: string; secondary?: string } {
  const out: { primary?: string; secondary?: string } = {};
  for (const ch of partChannels(c, part)) {
    const v = ch === 'primary' ? colors.primary : colors.secondary;
    if (v) out[ch] = v;
  }
  return out;
}

/** Sim command payload (`newCharacter` / `init.character`); colors only for tinted channels. */
export function toSpec(c: ContentIndex, d: CreatorDraft): CharacterSpec {
  const preset = headPreset(d.head);
  const parts: CharacterSpec['appearance']['parts'] = {};
  if (usesHeadSlot(c)) {
    parts.head = {
      part: preset.head,
      colors: channelColors(c, preset.head, { primary: d.hairColor }),
    };
  } else {
    parts.face = {
      part: preset.face,
      colors: channelColors(c, preset.face, { primary: d.hairColor }),
    };
    parts.hair = {
      part: preset.hairPart,
      colors: channelColors(c, preset.hairPart, { primary: d.hairColor }),
    };
  }
  for (const slot of CLOTH_SLOTS) {
    const ch = d[slot];
    parts[slot] = { part: ch.part, colors: channelColors(c, ch.part, ch) };
  }
  const skills = Object.fromEntries(Object.entries(d.skills).filter(([, n]) => n > 0));
  return {
    firstName: d.firstName.trim(),
    lastName: d.lastName.trim(),
    appearance: { skin: d.skin, parts },
    profession: d.profession,
    traits: [...d.traits],
    skills,
  };
}

export const checkDraft = (c: ContentIndex, d: CreatorDraft): CharacterCheck =>
  checkCharacter(c, toSpec(c, d));

export interface Budget {
  /** `startPoints` + `profession.points`. */
  pool: number;
  /** Spent on skill levels. */
  skills: number;
  /** Σ positive trait costs (merits, spend points). */
  merits: number;
  /** Σ |negative trait costs| (flaws, give points). */
  flaws: number;
  /** pool − skills − merits + flaws (must be ≥ 0 to start). */
  left: number;
}

export function budget(c: ContentIndex, d: CreatorDraft): Budget {
  const cc = creation(c);
  const pool = cc.startPoints + (c.professions.get(d.profession)?.points ?? 0);
  let skills = 0;
  for (const n of Object.values(d.skills)) skills += skillCost(cc.skillPointCost, n);
  let merits = 0;
  let flaws = 0;
  for (const id of d.traits) {
    const cost = c.traits.get(id)?.cost ?? 0;
    if (cost > 0) merits += cost;
    else flaws -= cost;
  }
  return { pool, skills, merits, flaws, left: pool - skills - merits + flaws };
}

/** Levels from profession + traits (incl. the profession's free traits), by skill id. */
export function bonusLevels(c: ContentIndex, d: CreatorDraft): Map<string, number> {
  const prof = c.professions.get(d.profession);
  const traits = allTraits(c, d).flatMap((id) => c.traits.get(id) ?? []);
  const out = new Map<string, number>();
  for (const b of [...(prof?.skillBonuses ?? []), ...traits.flatMap((t) => t.skillBonuses)])
    out.set(b.skill, (out.get(b.skill) ?? 0) + b.levels);
  return out;
}

export interface SkillRow {
  id: string;
  group: string;
  /** Starting level + profession and trait bonuses. */
  base: number;
  /** Profession bonus only (the „BAZA” column). */
  profession: number;
  bought: number;
  total: number;
  /** Points spent on this skill. */
  cost: number;
  passive: boolean;
  canInc: boolean;
  canDec: boolean;
}

const GROUP_ORDER = ['combat', 'survival', 'crafting', 'movement'];

export function skillRows(c: ContentIndex, d: CreatorDraft): SkillRow[] {
  const cc = creation(c);
  const bonus = bonusLevels(c, d);
  const profBonus = new Map(
    (c.professions.get(d.profession)?.skillBonuses ?? []).map((b) => [b.skill, b.levels]),
  );
  const left = budget(c, d).left;
  const rows = c.skills.map((s): SkillRow => {
    const bought = d.skills[s.id] ?? 0;
    const base = Math.max(0, Math.min(SKILL_MAX, s.startingLevel + (bonus.get(s.id) ?? 0)));
    const next = skillCost(cc.skillPointCost, bought + 1) - skillCost(cc.skillPointCost, bought);
    return {
      id: s.id,
      group: s.group,
      base,
      profession: profBonus.get(s.id) ?? 0,
      bought,
      total: Math.min(SKILL_MAX, base + bought),
      cost: skillCost(cc.skillPointCost, bought),
      passive: s.passive,
      canInc:
        !s.passive && bought < cc.maxSkillLevelAtStart && base + bought < SKILL_MAX && next <= left,
      canDec: bought > 0,
    };
  });
  const g = (r: SkillRow) => {
    const i = GROUP_ORDER.indexOf(r.group);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  return rows.sort((a, b) => g(a) - g(b));
}

export function setSkill(d: CreatorDraft, id: string, levels: number): CreatorDraft {
  const skills = { ...d.skills };
  if (levels > 0) skills[id] = levels;
  else delete skills[id];
  return { ...d, skills };
}

export function incSkill(c: ContentIndex, d: CreatorDraft, id: string): CreatorDraft {
  const row = skillRows(c, d).find((r) => r.id === id);
  return row?.canInc ? setSkill(d, id, row.bought + 1) : d;
}

export function decSkill(d: CreatorDraft, id: string): CreatorDraft {
  return setSkill(d, id, (d.skills[id] ?? 0) - 1);
}

/** Picked traits plus the profession's free traits (sorted, unique). */
export function allTraits(c: ContentIndex, d: CreatorDraft): string[] {
  const free = c.professions.get(d.profession)?.freeTraits ?? [];
  return [...new Set([...d.traits, ...free])].sort();
}

const conflicts = (a: Trait | undefined, b: Trait | undefined): boolean =>
  !!a && !!b && (a.conflicts.includes(b.id) || b.conflicts.includes(a.id));

export interface TraitRow {
  id: string;
  cost: number;
  positive: boolean;
  selected: boolean;
  /** Free trait of the profession (shown selected, not removable). */
  fromProfession: boolean;
  /** Conflicting selected trait (row disabled), if any. */
  blockedBy?: { id: string; fromProfession: boolean; positive: boolean };
}

/** Selectable traits split into merits (cost > 0) and flaws, in content order by cost. */
export function traitRows(
  c: ContentIndex,
  d: CreatorDraft,
): { merits: TraitRow[]; flaws: TraitRow[] } {
  const free = new Set(c.professions.get(d.profession)?.freeTraits ?? []);
  const chosen = allTraits(c, d);
  const rows: TraitRow[] = [];
  for (const t of c.traits.values()) {
    if (!t.selectable && !free.has(t.id)) continue;
    const selected = chosen.includes(t.id);
    const row: TraitRow = {
      id: t.id,
      cost: t.cost,
      positive: t.cost > 0 || (t.cost === 0 && t.polarity !== 'negative'),
      selected,
      fromProfession: free.has(t.id),
    };
    if (!selected) {
      const by = chosen.find((o) => conflicts(t, c.traits.get(o)));
      if (by)
        row.blockedBy = {
          id: by,
          fromProfession: free.has(by),
          positive: (c.traits.get(by)?.cost ?? 0) > 0,
        };
    }
    rows.push(row);
  }
  const order = (a: TraitRow, b: TraitRow) =>
    Math.abs(b.cost) - Math.abs(a.cost) || (a.id < b.id ? -1 : 1);
  return {
    merits: rows.filter((r) => r.positive).sort(order),
    flaws: rows.filter((r) => !r.positive).sort(order),
  };
}

export function toggleTrait(c: ContentIndex, d: CreatorDraft, id: string): CreatorDraft {
  if (d.traits.includes(id)) return { ...d, traits: d.traits.filter((t) => t !== id) };
  const t = c.traits.get(id);
  if (!t?.selectable) return d;
  if (allTraits(c, d).some((o) => o === id || conflicts(t, c.traits.get(o)))) return d;
  return { ...d, traits: [...d.traits, id] };
}

/** Changing profession drops picked traits that now duplicate or conflict with its free traits. */
export function setProfession(c: ContentIndex, d: CreatorDraft, id: string): CreatorDraft {
  const prof: Profession | undefined = c.professions.get(id);
  if (!prof) return d;
  const free = prof.freeTraits;
  const traits = d.traits.filter(
    (t) => !free.includes(t) && !free.some((f) => conflicts(c.traits.get(t), c.traits.get(f))),
  );
  return { ...d, profession: id, traits };
}

const FIRST = [
  'Adam',
  'Marek',
  'Piotr',
  'Tomasz',
  'Kamil',
  'Jan',
  'Paweł',
  'Michał',
  'Krzysztof',
  'Wojciech',
  'Łukasz',
  'Bartek',
];
const LAST = [
  'Nowak',
  'Kowalski',
  'Wiśniewski',
  'Wójcik',
  'Kamiński',
  'Lewandowski',
  'Zieliński',
  'Szymański',
  'Woźniak',
  'Dąbrowski',
  'Kozłowski',
  'Mazur',
];

const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length)]!;

export const randomName = (rng: Rng): string => `${pick(FIRST, rng)} ${pick(LAST, rng)}`;

/** Random cloth part and colors per clothing slot. */
function randomCloth(c: ContentIndex, rng: Rng): Pick<CreatorDraft, ClothSlot> {
  const cloth = paletteColors(c, CLOTH_PALETTE).map((x) => x.id);
  const choice = (slot: ClothSlot): ClothChoice => ({
    part: pick(clothOptions(c, slot), rng).part,
    primary: pick(cloth, rng),
    secondary: pick(cloth, rng),
  });
  return { top: choice('top'), bottom: choice('bottom'), shoes: choice('shoes') };
}

/** „Losowy ubiór”: new top, trousers and shoes with colors (name, head and skin stay). */
export const randomizeOutfit = (c: ContentIndex, d: CreatorDraft, rng: Rng): CreatorDraft => ({
  ...d,
  ...randomCloth(c, rng),
});

/** „Losuj”: new name, head, skin, hair and clothes (profession, skills and traits stay). */
export function randomizeLook(c: ContentIndex, d: CreatorDraft, rng: Rng): CreatorDraft {
  const cloth = randomCloth(c, rng);
  return {
    ...d,
    ...splitName(randomName(rng)),
    head: pick(HEAD_PRESETS, rng).id,
    skin: pick(
      paletteColors(c, SKIN_PALETTE).map((x) => x.id),
      rng,
    ),
    hairColor: pick(
      paletteColors(c, HAIR_PALETTE).map((x) => x.id),
      rng,
    ),
    ...cloth,
  };
}

/** Fisher–Yates copy. */
function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Buys random skill levels (same rules as the + button: not passive, ≤ `maxSkillLevelAtStart`
 * bought, total ≤ 10, next level affordable) until no point is left. Starts from `d.skills`.
 */
function spendOnSkills(c: ContentIndex, d: CreatorDraft, rng: Rng): CreatorDraft {
  let out = d;
  for (let guard = 0; guard < 500 && budget(c, out).left > 0; guard++) {
    const rows = skillRows(c, out).filter((r) => r.canInc);
    if (!rows.length) break;
    // Prefer deepening already bought skills now and then (specialists, not 1 level everywhere).
    const deeper = rows.filter((r) => r.bought > 0);
    const from = deeper.length && rng() < 0.45 ? deeper : rows;
    out = incSkill(c, out, pick(from, rng).id);
  }
  return out;
}

/**
 * „Losuj umiejętności”: profession and traits stay, skills are re-rolled and spend every point
 * (start pool + profession − merits + flaws). Leaves 0 whenever the traits leave anything ≥ 0.
 */
export function randomizeSkills(c: ContentIndex, d: CreatorDraft, rng: Rng): CreatorDraft {
  const empty = { ...d, skills: {} };
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = spendOnSkills(c, empty, rng);
    if (budget(c, r).left <= 0) return r;
  }
  // Practically unreachable (every skill capped): cheapest levels first.
  return spendOnSkills(c, empty, () => 0);
}

/** Selectable traits the draft could pick (not a free trait, nor conflicting with one). */
function pickableTraits(c: ContentIndex, d: CreatorDraft): Trait[] {
  const free = c.professions.get(d.profession)?.freeTraits ?? [];
  return [...c.traits.values()].filter(
    (t) => t.selectable && !free.includes(t.id) && !free.some((f) => conflicts(t, c.traits.get(f))),
  );
}

const MAX_RANDOM_TRAITS = 6;

/**
 * Random conflict-free set of `pool` traits whose Σ cost is exactly `target`
 * (randomised depth-first search; undefined when no such set exists).
 */
function traitSet(pool: readonly Trait[], target: number, rng: Rng): Trait[] | undefined {
  let nodes = 0;
  const chosen: Trait[] = [];
  const dfs = (i: number, sum: number): boolean => {
    if (++nodes > 20000) return false;
    if (i === pool.length || chosen.length === MAX_RANDOM_TRAITS) return sum === target;
    const t = pool[i]!;
    const ok = !chosen.some((o) => conflicts(t, o));
    const take = (): boolean => {
      if (!ok) return false;
      chosen.push(t);
      if (dfs(i + 1, sum + t.cost)) return true;
      chosen.pop();
      return false;
    };
    // Bias towards 2–4 picked traits so the result looks like a hand-made character.
    const pTake = chosen.length < 2 ? 0.6 : chosen.length < 4 ? 0.35 : 0.15;
    return rng() < pTake ? take() || dfs(i + 1, sum) : dfs(i + 1, sum) || take();
  };
  return dfs(0, 0) ? [...chosen] : undefined;
}

/**
 * „Losuj cechy”: profession and skills stay, traits are re-rolled (selectable, no conflicts,
 * profession free traits respected) so the final balance is exactly 0. If no trait set can
 * close the balance exactly, the closest set that leaves points is used and the remainder is
 * spent on skill levels.
 */
export function randomizeTraits(c: ContentIndex, d: CreatorDraft, rng: Rng): CreatorDraft {
  const base = { ...d, traits: [] as string[] };
  const target = budget(c, base).left; // Σ trait costs that brings the balance to 0
  const pool = shuffled(pickableTraits(c, base), rng);
  const exact = traitSet(pool, target, rng);
  if (exact) return { ...base, traits: exact.map((t) => t.id) };
  for (let t = target - 1; t >= target - 20; t--) {
    const set = traitSet(pool, t, rng);
    if (set) {
      const r = spendOnSkills(c, { ...base, traits: set.map((x) => x.id) }, rng);
      if (budget(c, r).left === 0) return r;
    }
  }
  return spendOnSkills(c, base, rng);
}

/** 3D look of the draft (hex colors per mesh). */
export function draftLook(c: ContentIndex, d: CreatorDraft): RenderLook {
  const hex = (pal: string, id: string) => paletteHex(c, pal, id);
  const head = headPreset(d.head);
  const hair = hex(HAIR_PALETTE, d.hairColor);
  const parts: {
    ref: RenderLook['parts'][number]['ref'];
    colors: { primary?: string; secondary?: string };
  }[] = [{ ref: head.mesh, colors: hair ? { primary: hair } : {} }];
  for (const slot of CLOTH_SLOTS) {
    const ch = d[slot];
    const pr = hex(CLOTH_PALETTE, ch.primary);
    const se = hex(CLOTH_PALETTE, ch.secondary);
    parts.push({
      ref: clothOption(slot, ch.part).mesh,
      colors: { ...(pr ? { primary: pr } : {}), ...(se ? { secondary: se } : {}) },
    });
  }
  return { skin: hex(SKIN_PALETTE, d.skin) ?? '#d9ad8a', parts };
}

/** Polish text for the sim's first validation error (`commandRejected.detail` format). */
export function errorText(e: string | undefined): string {
  if (!e) return '';
  const [kind = '', arg = ''] = e.split(':');
  switch (kind) {
    case 'name':
      return arg === 'first' ? 'Podaj imię (2–24 znaki)' : 'Nazwisko: 2–24 znaki albo puste';
    case 'over-budget':
      return `Brakuje punktów: ${arg.replace('-', '')}`;
    case 'trait-conflict':
      return 'Wybrane cechy się wykluczają';
    case 'missing-slot':
      return `Brak części wyglądu: ${arg}`;
    default:
      return `Nieprawidłowa postać (${e})`;
  }
}
