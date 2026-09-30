import type { Condition } from '../../schemas/common/condition.js';
import type { StatModifier } from '../../schemas/common/stat-modifier.js';
import type { PathSegment } from '../json-path.js';
import type { RefList } from './ref-collector.js';

/** Referencje z warunku `when` (moodle, umiejętność, cecha), rekurencyjnie przez all/any/not. */
export function collectConditionRefs(c: Condition, r: RefList, ...path: PathSegment[]): void {
  if ('moodle' in c) r.add('moodle', c.moodle, ...path, 'moodle');
  else if ('skill' in c) r.add('skill', c.skill, ...path, 'skill');
  else if ('trait' in c) r.add('trait', c.trait, ...path, 'trait');
  else if ('all' in c) c.all.forEach((x, i) => collectConditionRefs(x, r, ...path, 'all', i));
  else if ('any' in c) c.any.forEach((x, i) => collectConditionRefs(x, r, ...path, 'any', i));
  else if ('not' in c) collectConditionRefs(c.not, r, ...path, 'not');
}

/** Referencje z listy modyfikatorów (tylko pola `when`). */
export function collectModifierRefs(
  mods: readonly StatModifier[],
  r: RefList,
  ...path: PathSegment[]
): void {
  mods.forEach((m, i) => {
    if (m.when) collectConditionRefs(m.when, r, ...path, i, 'when');
  });
}
