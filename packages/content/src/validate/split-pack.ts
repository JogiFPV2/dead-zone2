import {
  CONTENT_FOLDERS,
  MANIFEST_FILE,
  MAPS_FOLDER,
  OVERRIDES_FOLDER,
  WORLD_SETTINGS_DIR,
  WORLD_SETTINGS_FILE,
  type ContentType,
} from '../schemas/content-type.js';
import type { ErrorSink } from './errors.js';
import type { PackFile, PackSource } from './pack-source.js';
import type { SourceRef } from './source.js';

/** Surowy obiekt z pliku, jeszcze przed walidacją schematem. */
export interface RawDefinition {
  type: ContentType;
  raw: unknown;
  source: SourceRef;
}

export interface RawDocument {
  raw: unknown;
  source: SourceRef;
}

export interface LoadedPack {
  dir: string;
  manifest: RawDocument | undefined;
  /** `world-settings.json`, potem fragmenty `world-settings/*.json` w kolejności ścieżek. */
  worldSettings: RawDocument[];
  definitions: RawDefinition[];
  overrides: RawDocument[];
  /** Pliki z `maps/` (manifesty i chunki), sprawdzane przez validateMaps. */
  maps: RawDocument[];
}

const FOLDER_TO_TYPE = new Map<string, ContentType>(
  Object.entries(CONTENT_FOLDERS).map(([type, folder]) => [folder, type as ContentType]),
);

/**
 * Rozkłada pliki paczki: `mod.json`, `world-settings.json` (+ `world-settings/`), katalogi typów
 * i `overrides/`. Plik w katalogu typu zawiera jedną definicję (obiekt) albo ich listę (tablicę).
 */
export function splitPack(source: PackSource, sink: ErrorSink): LoadedPack {
  const pack: LoadedPack = {
    dir: source.dir,
    manifest: undefined,
    worldSettings: [],
    definitions: [],
    overrides: [],
    maps: [],
  };
  const files = [...source.files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of files) {
    if (!file.path.endsWith('.json')) continue;
    const at: SourceRef = { pack: source.dir, file: file.path, path: [] };
    const json = parseFile(file, at, sink);
    if (json === undefined) continue;

    if (file.path === MANIFEST_FILE) {
      pack.manifest = { raw: json, source: at };
      continue;
    }
    if (file.path === WORLD_SETTINGS_FILE) {
      pack.worldSettings.unshift({ raw: json, source: at });
      continue;
    }
    if (file.path.startsWith(WORLD_SETTINGS_DIR)) {
      pack.worldSettings.push({ raw: json, source: at });
      continue;
    }
    const folder = file.path.split('/')[0] ?? '';
    if (folder === MAPS_FOLDER) {
      pack.maps.push({ raw: json, source: at });
      continue;
    }
    const type = FOLDER_TO_TYPE.get(folder);
    const isOverrides = folder === OVERRIDES_FOLDER;
    if (!type && !isOverrides) {
      if (!folder.startsWith('i18n')) {
        sink.add({
          code: 'unknown_folder',
          message: `plik poza znanymi katalogami: ${Object.values(CONTENT_FOLDERS).join(', ')}, ${OVERRIDES_FOLDER}, ${MAPS_FOLDER}`,
          ...ref(at),
        });
      }
      continue;
    }
    const list: unknown[] = Array.isArray(json) ? json : [json];
    list.forEach((raw, i) => {
      const src: SourceRef = { ...at, path: Array.isArray(json) ? [i] : [] };
      if (type) pack.definitions.push({ type, raw, source: src });
      else pack.overrides.push({ raw, source: src });
    });
  }
  return pack;
}

function parseFile(file: PackFile, at: SourceRef, sink: ErrorSink): unknown {
  if ('json' in file) return file.json;
  try {
    return JSON.parse(file.text) as unknown;
  } catch (e) {
    sink.add({
      code: 'json_parse',
      message: `niepoprawny JSON: ${(e as Error).message}`,
      ...ref(at),
    });
    return undefined;
  }
}

function ref(at: SourceRef) {
  return { pack: at.pack, file: at.file, path: '$' };
}
