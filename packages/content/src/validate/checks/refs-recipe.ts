import type { Recipe } from '../../schemas/recipe/recipe.js';
import type { RefList } from './ref-collector.js';

export function collectRecipeRefs(recipe: Recipe, r: RefList): void {
  recipe.ingredients.forEach((ing, i) => r.matcher(ing, 'ingredients', i));
  recipe.tools.forEach((t, i) => r.matcher(t, 'tools', i));
  recipe.skills.forEach((s, i) => r.add('skill', s.skill, 'skills', i, 'skill'));
  recipe.results.forEach((res, i) => r.add('item', res.item, 'results', i, 'item'));
  recipe.xp.forEach((x, i) => r.add('skill', x.skill, 'xp', i, 'skill'));
}
