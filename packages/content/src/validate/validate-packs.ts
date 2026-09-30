import type { ModManifest } from '../schemas/mod-manifest.js';
import type { WorldSettings } from '../schemas/world-settings.js';
import { addDefinitions } from './add-definitions.js';
import { applyOverrides } from './apply-overrides.js';
import { checkItemKinds } from './checks/check-kinds.js';
import { checkLootCycles } from './checks/check-loot-cycles.js';
import { checkRecipeLearning } from './checks/check-recipe-learning.js';
import { checkRefs } from './checks/check-refs.js';
import { checkTraitConflicts } from './checks/check-trait-conflicts.js';
import { ContentIndex } from './content-index.js';
import { ErrorSink, type ContentError } from './errors.js';
import { resolveLoadOrder } from './load-order.js';
import type { MapData } from './maps/map-data.js';
import { validateMaps } from './maps/validate-maps.js';
import type { PackSource } from './pack-source.js';
import { parseManifest } from './parse-manifest.js';
import { splitPack, type LoadedPack, type RawDocument } from './split-pack.js';
import { mergeWorldSettings } from './world-settings.js';

export interface ValidationResult {
  ok: boolean;
  errors: ContentError[];
  /** Manifesty w ustalonej kolejności wczytywania. */
  loadOrder: ModManifest[];
  /** Końcowa zawartość po nałożeniu wszystkich paczek i nadpisań. */
  content: ContentIndex;
  worldSettings: WorldSettings;
  /** Mapy wszystkich paczek (`maps/<mapId>/`), warstwy zdekodowane. */
  maps: MapData[];
}

/**
 * Waliduje paczki (base + mody; kolejność wejścia nie ma znaczenia — liczy się manifest):
 * 1. JSON i manifest, 2. kolejność wczytywania, 3. schemat każdej definicji, namespace, duplikaty,
 * 4. nadpisania, 5. referencje krzyżowe na końcowym zbiorze, 6. mapy.
 */
export function validatePacks(sources: readonly PackSource[]): ValidationResult {
  const sink = new ErrorSink();
  const index = new ContentIndex();

  const loaded: { dir: string; pack: LoadedPack; manifest: ModManifest }[] = [];
  for (const source of sources) {
    const pack = splitPack(source, sink);
    const manifest = parseManifest(pack, sink);
    // Bez poprawnego manifestu nie znamy namespace ani kolejności — sprawdzamy tylko schematy.
    if (manifest) loaded.push({ dir: source.dir, pack, manifest });
    else addDefinitions(pack.definitions, undefined, new ContentIndex(), sink);
  }

  const ordered = resolveLoadOrder(loaded, sink);
  const worldDocs: RawDocument[] = [];
  for (const { pack, manifest } of ordered) {
    addDefinitions(pack.definitions, manifest.id, index, sink);
    applyOverrides(pack.overrides, index, sink);
    worldDocs.push(...pack.worldSettings);
  }
  const worldSettings = mergeWorldSettings(worldDocs, sink);

  checkRefs(index, sink);
  checkItemKinds(index, sink);
  checkLootCycles(index, sink);
  checkTraitConflicts(index, sink);
  checkRecipeLearning(index, sink);
  const maps = validateMaps(ordered, index, sink);

  return {
    ok: sink.errors.length === 0,
    errors: sink.errors,
    loadOrder: ordered.map((p) => p.manifest),
    content: index,
    worldSettings,
    maps,
  };
}
