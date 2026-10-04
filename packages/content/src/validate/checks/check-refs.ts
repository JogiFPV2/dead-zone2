import type { ContentIndex, IndexedDefinition } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import {
  collectAppearanceRefs,
  collectMoodleRefs,
  collectProfessionRefs,
  collectTraitRefs,
} from './refs-character.js';
import { collectGameModeRefs } from './refs-game-mode.js';
import { collectItemRefs } from './refs-item.js';
import { collectRecipeRefs } from './refs-recipe.js';
import { collectTagDefRefs } from './refs-tag.js';
import {
  collectContainerTypeRefs,
  collectLootTableRefs,
  collectStationRefs,
  collectZombieTypeRefs,
  collectAnimalTypeRefs,
} from './refs-world.js';
import { RefList } from './ref-collector.js';

export function collectRefs(def: IndexedDefinition): RefList {
  const r = new RefList();
  const d = def as IndexedDefinition<never> & { data: never };
  switch (def.type) {
    case 'item':
      collectItemRefs(d.data, r);
      break;
    case 'recipe':
      collectRecipeRefs(d.data, r);
      break;
    case 'trait':
      collectTraitRefs(d.data, r);
      break;
    case 'profession':
      collectProfessionRefs(d.data, r);
      break;
    case 'lootTable':
      collectLootTableRefs(d.data, r);
      break;
    case 'zombieType':
      collectZombieTypeRefs(d.data, r);
      break;
    case 'animalType':
      collectAnimalTypeRefs(d.data, r);
      break;
    case 'containerType':
      collectContainerTypeRefs(d.data, r);
      break;
    case 'moodle':
      collectMoodleRefs(d.data, r);
      break;
    case 'gameMode':
      collectGameModeRefs(d.data, r);
      break;
    case 'station':
      collectStationRefs(d.data, r);
      break;
    case 'appearancePart':
      collectAppearanceRefs(d.data, r);
      break;
    case 'tag':
      collectTagDefRefs(d.data, r);
      break;
    case 'skill':
    case 'tile':
    case 'palette':
      break;
  }
  return r;
}

/** Zbiór wszystkich tagów użytych przez przedmioty. */
function itemTags(index: ContentIndex): Set<string> {
  const tags = new Set<string>();
  for (const item of index.map('item').values()) item.data.tags.forEach((t) => tags.add(t));
  return tags;
}

/** Każda referencja musi wskazywać istniejącą definicję; każdy tag — co najmniej jeden przedmiot. */
export function checkRefs(index: ContentIndex, sink: ErrorSink): void {
  const tags = itemTags(index);
  for (const def of index.all()) {
    const r = collectRefs(def);
    const at = (path: (string | number)[]) => ({
      pack: def.source.pack,
      file: def.source.file,
      path: formatJsonPath([...def.source.path, ...path]),
    });
    for (const ref of r.refs) {
      if (!index.has(ref.type, ref.id)) {
        sink.add({
          code: 'missing_ref',
          message: `${def.type} „${def.id}” wskazuje na nieistniejące ${ref.type} „${ref.id}”`,
          ...at(ref.path),
        });
      }
    }
    for (const t of r.tags) {
      if (!tags.has(t.tag)) {
        sink.add({
          code: 'missing_tag',
          message: `żaden przedmiot nie ma tagu „${t.tag}” (${def.type} „${def.id}”)`,
          ...at(t.path),
        });
      }
    }
  }
}
