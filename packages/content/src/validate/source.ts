import type { PathSegment } from './json-path.js';

/** Skąd pochodzi definicja: paczka, plik i ścieżka do obiektu w pliku. */
export interface SourceRef {
  pack: string;
  file: string;
  path: PathSegment[];
}
