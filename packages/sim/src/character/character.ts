import type { CharacterSpec, CharacterProfileView, CommandRejectReason } from '@deadzone/protocol';
import type { CompiledModifier, ContentIndex } from '../content/adapter.js';
import { gameMinuteAt } from '../core/clock.js';
import type { HashWriter } from '../core/hash.js';
import { hashString32 } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { addPieces } from '../items/actions.js';
import { playerItems, stableIdOf } from '../items/inventory.js';
import type { ItemStore } from '../items/store.js';
import { learnRecipe, progressOf, SKILL_MAX } from '../progress/skills.js';
import { refreshModifiers } from '../systems/moodles.js';

/** The created character (kept in `ItemStore.characters`, saved with the items). */
export type CharacterState = CharacterProfileView;

/** `worldSettings.characterCreation` defaults (content schema defaults). */
const DEFAULTS = {
  startPoints: 8,
  maxSkillLevelAtStart: 3,
  skillPointCost: [1, 2, 3],
  name: { minLen: 2, maxLen: 24 },
  skinPalette: 'base:skin',
};
const CHANNELS = ['primary', 'secondary'] as const;

export type CharacterCheck =
  { ok: true; state: CharacterState } | { ok: false; errors: string[]; pointsLeft: number };

/** Points for `levels` bought levels: Σ `skillPointCost[0..levels-1]` (last cost repeats). */
export function skillCost(cost: readonly number[], levels: number): number {
  let sum = 0;
  for (let i = 0; i < levels; i++) sum += cost[Math.min(i, cost.length - 1)] ?? 1;
  return sum;
}

/**
 * Validates a creator result against content (names, appearance slots, parts and palette
 * colors, profession, selectable non-conflicting traits, bought skill levels, the point pool)
 * and resolves it: every tint channel gets a color, profession `freeTraits` are added.
 */
export function checkCharacter(c: ContentIndex, spec: CharacterSpec): CharacterCheck {
  const cc = c.characterCreation ?? DEFAULTS;
  const errors: string[] = [];
  const nameOk = (n: string) =>
    n.trim().length >= cc.name.minLen && n.trim().length <= cc.name.maxLen;
  if (!nameOk(spec.firstName)) errors.push('name:first');
  // Surname is optional: empty is fine, otherwise the same length rule as the first name.
  if (spec.lastName.trim() !== '' && !nameOk(spec.lastName)) errors.push('name:last');
  // Appearance.
  const palette = (id: string) => c.palettes.get(id);
  const inPalette = (pid: string, color: string): boolean => {
    const p = palette(pid);
    return !p || p.colors.some((x) => x.id === color);
  };
  if (!inPalette(cc.skinPalette, spec.appearance.skin)) errors.push(`skin:${spec.appearance.skin}`);
  const slots = new Set([...c.appearanceParts.values()].map((p) => p.slot as string));
  const defaults = c.characterCreation?.defaultAppearance?.parts as
    | Readonly<Record<string, { part: string; colors?: Readonly<Record<string, string>> }>>
    | undefined;
  const required = defaults
    ? Object.keys(defaults)
    : [...slots].filter((s) => s !== 'beard').sort();
  const parts: CharacterState['appearance']['parts'] = {};
  for (const slot of required)
    if (!spec.appearance.parts[slot]) errors.push(`missing-slot:${slot}`);
  for (const slot of Object.keys(spec.appearance.parts).sort()) {
    const choice = spec.appearance.parts[slot]!;
    if (!slots.has(slot)) {
      errors.push(`slot-unknown:${slot}`);
      continue;
    }
    const def = c.appearanceParts.get(choice.part);
    if (!def) {
      errors.push(`part-unknown:${choice.part}`);
      continue;
    }
    if (def.slot !== slot) errors.push(`part-slot:${slot}`);
    const colors: { primary?: string; secondary?: string } = {};
    for (const ch of CHANNELS) {
      const tint = def.tints.find((t) => t.channel === ch);
      const given = choice.colors?.[ch];
      if (!tint) {
        if (given !== undefined) errors.push(`color:${slot}.${ch}`);
        continue;
      }
      const fallback =
        (defaults?.[slot]?.part === def.id ? defaults[slot].colors?.[ch] : undefined) ??
        palette(tint.palette)?.colors[0]?.id;
      const color = given ?? fallback;
      if (color === undefined) continue;
      if (!inPalette(tint.palette, color)) errors.push(`color:${slot}.${ch}`);
      colors[ch] = color;
    }
    parts[slot] = { part: def.id, colors };
  }
  // Profession and traits.
  const prof = c.professions.get(spec.profession);
  if (!prof) errors.push(`profession:${spec.profession}`);
  const picked = spec.traits ?? [];
  let points = cc.startPoints + (prof?.points ?? 0);
  const seen = new Set<string>();
  for (const id of picked) {
    const t = c.traits.get(id);
    if (!t) errors.push(`trait-unknown:${id}`);
    else if (!t.selectable) errors.push(`trait-not-selectable:${id}`);
    else if (seen.has(id)) errors.push(`trait-duplicate:${id}`);
    else points -= t.cost;
    seen.add(id);
  }
  const traits = [...new Set([...picked, ...(prof?.freeTraits ?? [])])].sort();
  for (const id of traits) {
    for (const other of c.traits.get(id)?.conflicts ?? []) {
      if (other > id && traits.includes(other)) errors.push(`trait-conflict:${id}/${other}`);
    }
  }
  // Bought skill levels.
  const skills: Record<string, number> = {};
  for (const id of Object.keys(spec.skills ?? {}).sort()) {
    const n = spec.skills![id]!;
    const i = c.skillIndex.get(id);
    if (i === undefined) errors.push(`skill-unknown:${id}`);
    else if (c.skills[i]!.passive && n > 0) errors.push(`skill-passive:${id}`);
    else if (n > cc.maxSkillLevelAtStart) errors.push(`skill-max:${id}`);
    else if (n > 0) {
      points -= skillCost(cc.skillPointCost, n);
      skills[id] = n;
    }
  }
  if (points < 0) errors.push(`over-budget:${points}`);
  if (errors.length > 0) return { ok: false, errors, pointsLeft: points };
  return {
    ok: true,
    state: {
      firstName: spec.firstName.trim(),
      lastName: spec.lastName.trim(),
      appearance: { skin: spec.appearance.skin, parts },
      profession: prof!.id,
      traits,
      skills,
      pointsLeft: points,
    },
  };
}

/** Applies a checked character: skills (start + bonuses + bought), XP multipliers, recipes, items. */
export function applyCharacter(w: SimWorld, eid: number, ch: CharacterState): void {
  const st = w.items!;
  const c = st.content;
  const sid = stableIdOf(w, eid);
  st.characters.set(sid, ch);
  const prog = progressOf(w, eid);
  const prof = c.professions.get(ch.profession);
  const traits = ch.traits.flatMap((id) => c.traits.get(id) ?? []);
  if (prog) {
    const bonus = new Map<string, number>();
    for (const b of [...(prof?.skillBonuses ?? []), ...traits.flatMap((t) => t.skillBonuses)])
      bonus.set(b.skill, (bonus.get(b.skill) ?? 0) + b.levels);
    c.skills.forEach((s, i) => {
      const lvl = s.startingLevel + (bonus.get(s.id) ?? 0) + (ch.skills[s.id] ?? 0);
      prog.level[i] = Math.max(0, Math.min(SKILL_MAX, lvl));
    });
    for (const t of traits) {
      for (const m of t.xpMultipliers) {
        const i = c.skillIndex.get(m.skill);
        if (i !== undefined) prog.xpMul[i] = Math.fround((prog.xpMul[i] ?? 1) * m.multiplier);
      }
    }
    for (const id of [...(prof?.knownRecipes ?? []), ...traits.flatMap((t) => t.knownRecipes)]) {
      const ri = c.recipeIndex.get(id);
      if (ri !== undefined) learnRecipe(st, prog, ri);
    }
  }
  const p = playerItems(w, eid);
  if (p) {
    const minute = gameMinuteAt(w.clock, w.tick);
    for (const it of prof?.startingItems ?? []) {
      const def = c.itemIndex.get(it.item);
      if (def !== undefined) addPieces(st, def, p.inventory, it.count, minute);
    }
  }
  if (w.survival) refreshModifiers(w, w.survival, eid);
  st.version++;
  w.events.push({
    type: 'characterCreated',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    character: ch,
  });
}

/** `newCharacter`: once per player. Returns a reject reason and detail (first problem). */
export function applyNewCharacter(
  w: SimWorld,
  eid: number,
  spec: CharacterSpec,
): { reason: CommandRejectReason; detail?: string } | undefined {
  const st = w.items;
  if (!st || !playerItems(w, eid)) return { reason: 'invalid-state' };
  if (st.characters.has(stableIdOf(w, eid))) return { reason: 'invalid-state' };
  const r = checkCharacter(st.content, spec);
  if (!r.ok) return { reason: 'invalid-character', detail: r.errors[0]! };
  applyCharacter(w, eid, r.state);
  return undefined;
}

/** Trait and profession rate modifiers of a player (after the moodle ones). */
export function characterMods(st: ItemStore, sid: number): CompiledModifier[] {
  const ch = st.characters.get(sid);
  if (!ch) return [];
  return [
    ...(st.content.professionMods.get(ch.profession) ?? []),
    ...ch.traits.flatMap((t) => st.content.traitMods.get(t) ?? []),
  ];
}

export const hasTrait = (w: SimWorld, eid: number, trait: string): boolean =>
  w.items?.characters.get(stableIdOf(w, eid))?.traits.includes(trait) ?? false;

/** Hash section (only when a character exists, keeps older goldens). */
export function hashCharacters(st: ItemStore, h: HashWriter): void {
  if (st.characters.size === 0) return;
  const sids = [...st.characters.keys()].sort((a, b) => a - b);
  h.u32(sids.length);
  for (const sid of sids) h.u32(sid).u32(hashString32(JSON.stringify(st.characters.get(sid))));
}
