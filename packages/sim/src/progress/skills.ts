import type { CommandRejectReason, SkillView } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import type { HashWriter } from '../core/hash.js';
import type { ContentIndex } from '../content/adapter.js';
import type { ItemStore } from '../items/store.js';

/** Highest skill level (content `SKILL_MAX_LEVEL`). */
export const SKILL_MAX = 10;

/**
 * Per-player progression (kept in `ItemStore.progress`, so it is saved with the items): skill
 * levels and XP towards the next level (index = `ContentIndex.skills`), learned recipes.
 */
export interface PlayerProgress {
  level: number[];
  /** f32 XP collected towards `xpPerLevel[level]`. */
  xp: number[];
  /** Learned recipe indices (sorted). */
  known: number[];
  /** XP multipliers by skill index (traits, books; 1 = none). */
  xpMul: number[];
}

export function createProgress(content: ContentIndex): PlayerProgress {
  return {
    level: content.skills.map((s) => s.startingLevel),
    xp: content.skills.map(() => 0),
    known: [],
    xpMul: content.skills.map(() => 1),
  };
}

export const progressOf = (w: SimWorld, eid: number): PlayerProgress | undefined =>
  w.items?.progress.get(w.c.StableId.value[eid] ?? 0);

export function skillLevel(w: SimWorld, eid: number, skill: string): number {
  const i = w.items?.content.skillIndex.get(skill);
  return i === undefined ? 0 : (progressOf(w, eid)?.level[i] ?? 0);
}

/** Adds XP (× multiplier); levels up while the next `xpPerLevel` is reached (`skillLevelUp`). */
export function addXp(w: SimWorld, eid: number, skill: string, amount: number): void {
  const st = w.items;
  const p = progressOf(w, eid);
  const i = st?.content.skillIndex.get(skill);
  if (!st || !p || i === undefined || amount <= 0) return;
  const def = st.content.skills[i]!;
  let level = p.level[i] ?? 0;
  if (level >= SKILL_MAX) return;
  let xp = Math.fround((p.xp[i] ?? 0) + amount * (p.xpMul[i] ?? 1));
  while (level < SKILL_MAX && xp >= (def.xpPerLevel[level] ?? Infinity)) {
    xp = Math.fround(xp - def.xpPerLevel[level]!);
    level++;
    w.events.push({
      type: 'skillLevelUp',
      tick: w.tick,
      playerId: w.c.Player.id[eid] ?? 0,
      skill,
      level,
    });
  }
  p.level[i] = level;
  p.xp[i] = level >= SKILL_MAX ? 0 : xp;
  st.version++;
}

export function learnRecipe(st: ItemStore, p: PlayerProgress, recipe: number): boolean {
  if (p.known.includes(recipe)) return false;
  p.known.push(recipe);
  p.known.sort((a, b) => a - b);
  st.version++;
  return true;
}

const isDefault = (st: ItemStore, p: PlayerProgress): boolean =>
  p.known.length === 0 &&
  p.xp.every((x) => x === 0) &&
  p.xpMul.every((x) => x === 1) &&
  p.level.every((l, i) => l === st.content.skills[i]!.startingLevel);

/** Hash section: only when some player differs from the defaults (keeps older goldens). */
export function hashProgress(st: ItemStore, h: HashWriter): void {
  const sids = [...st.progress.keys()].sort((a, b) => a - b);
  if (sids.every((sid) => isDefault(st, st.progress.get(sid)!))) return;
  h.u32(sids.length);
  for (const sid of sids) {
    const p = st.progress.get(sid)!;
    h.u32(sid).u32(p.level.length).u32(p.known.length);
    for (let i = 0; i < p.level.length; i++) h.u32(p.level[i]!).f32(p.xp[i]!).f32(p.xpMul[i]!);
    for (const r of p.known) h.u32(r);
  }
}

/** Dev: `debugSkill` / `debugLearnRecipe`. */
export function applyProgressCommand(
  w: SimWorld,
  eid: number,
  cmd:
    | { type: 'debugSkill'; skill: string; level: number }
    | { type: 'debugLearnRecipe'; recipe: string },
): CommandRejectReason | undefined {
  if (!w.dev) return 'dev-only';
  const st = w.items;
  const p = progressOf(w, eid);
  if (!st || !p) return 'invalid-state';
  if (cmd.type === 'debugSkill') {
    const i = st.content.skillIndex.get(cmd.skill);
    if (i === undefined) return 'unknown-item';
    p.level[i] = Math.min(SKILL_MAX, cmd.level);
    p.xp[i] = 0;
    st.version++;
    return undefined;
  }
  const ri = st.content.recipeIndex.get(cmd.recipe);
  if (ri === undefined) return 'unknown-item';
  if (learnRecipe(st, p, ri))
    w.events.push({
      type: 'recipeLearned',
      tick: w.tick,
      playerId: w.c.Player.id[eid] ?? 0,
      recipe: cmd.recipe,
    });
  return undefined;
}

export function skillViews(w: SimWorld, eid: number): SkillView[] {
  const st = w.items;
  const p = progressOf(w, eid);
  if (!st || !p) return [];
  return st.content.skills.map((def, i) => {
    const level = p.level[i] ?? 0;
    return {
      id: def.id,
      level,
      xp: Math.round((p.xp[i] ?? 0) * 10) / 10,
      next: level >= SKILL_MAX ? null : (def.xpPerLevel[level] ?? null),
    };
  });
}
