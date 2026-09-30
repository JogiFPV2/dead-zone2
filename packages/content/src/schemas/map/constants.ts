/** Bok chunka w kaflach (kontrakt z Silnikiem i Symulacją). */
export const CHUNK_SIZE = 32;
/** Liczba kafli w chunku = długość każdej warstwy. */
export const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;
/** Bieżąca wersja formatu plików mapy. */
export const MAP_FORMAT_VERSION = 1;
export const MAP_MANIFEST_FILE = 'manifest.json';
export const MAP_CHUNKS_FOLDER = 'chunks';

/** Indeks kafla w warstwie: `y * 32 + x`. */
export const tileIndex = (x: number, y: number): number => y * CHUNK_SIZE + x;
