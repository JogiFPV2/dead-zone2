import type { Moodle } from '../../schemas/moodle.js';
import type { Profession } from '../../schemas/profession.js';
import type { Trait } from '../../schemas/trait/trait.js';
import type { RefList } from './ref-collector.js';
import { collectModifierRefs } from './refs-condition.js';

export function collectTraitRefs(trait: Trait, r: RefList): void {
  r.many('trait', trait.conflicts, 'conflicts');
  trait.skillBonuses.forEach((b, i) => r.add('skill', b.skill, 'skillBonuses', i, 'skill'));
  trait.xpMultipliers.forEach((m, i) => r.add('skill', m.skill, 'xpMultipliers', i, 'skill'));
  r.many('recipe', trait.knownRecipes, 'knownRecipes');
  collectModifierRefs(trait.modifiers, r, 'modifiers');
}

export function collectProfessionRefs(p: Profession, r: RefList): void {
  p.skillBonuses.forEach((b, i) => r.add('skill', b.skill, 'skillBonuses', i, 'skill'));
  r.many('trait', p.freeTraits, 'freeTraits');
  r.many('recipe', p.knownRecipes, 'knownRecipes');
  p.startingItems.forEach((s, i) => r.add('item', s.item, 'startingItems', i, 'item'));
  collectModifierRefs(p.modifiers, r, 'modifiers');
}

export function collectMoodleRefs(m: Moodle, r: RefList): void {
  m.levels.forEach((l, i) => collectModifierRefs(l.modifiers, r, 'levels', i, 'modifiers'));
}
