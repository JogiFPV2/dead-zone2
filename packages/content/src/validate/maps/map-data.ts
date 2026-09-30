import type { MapChunk } from '../../schemas/map/chunk.js';
import type { MapManifest } from '../../schemas/map/manifest.js';

/** Zwalidowana mapa z paczki. Pliki: `maps/<folder>/manifest.json`, `maps/<folder>/chunks/…`. */
export interface MapData {
  /** `<namespace paczki>:<folder>`, np. `base:demo-house`. */
  id: string;
  /** Katalog paczki (jak w błędach walidatora). */
  pack: string;
  folder: string;
  manifest: MapManifest;
  /** W kolejności nazw plików. Warstwy jako `Uint16Array[1024]`. */
  chunks: MapChunk[];
  /** Ścieżki plików chunków względem paczki, równoległe do `chunks`. */
  chunkFiles: string[];
}
