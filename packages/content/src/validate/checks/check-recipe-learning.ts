import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

/** Id receptur, które da się poznać: książki/magazyny, zawody i cechy (`knownRecipes`). */
function learnableRecipes(index: ContentIndex): Set<string> {
  const out = new Set<string>();
  for (const { data } of index.map('item').values()) {
    if (data.kind === 'literature') data.literature.unlocksRecipes.forEach((r) => out.add(r));
  }
  for (const { data } of index.map('profession').values())
    data.knownRecipes.forEach((r) => out.add(r));
  for (const { data } of index.map('trait').values()) data.knownRecipes.forEach((r) => out.add(r));
  return out;
}

/** Receptura z `requiresLearning: true` musi być gdzieś odblokowana, inaczej nikt jej nie pozna. */
export function checkRecipeLearning(index: ContentIndex, sink: ErrorSink): void {
  const learnable = learnableRecipes(index);
  for (const def of index.map('recipe').values()) {
    if (!def.data.requiresLearning || learnable.has(def.id)) continue;
    sink.add({
      code: 'unlearnable_recipe',
      message: `receptury „${def.id}” nie odblokowuje żadna książka, zawód ani cecha`,
      pack: def.source.pack,
      file: def.source.file,
      path: formatJsonPath([...def.source.path, 'requiresLearning']),
    });
  }
}
