import { fileURLToPath } from 'node:url';

/** Ścieżka do paczki bazowej `data/base` (działa z `src/node/` i z `dist/node/`). */
export const BASE_PACK_DIR = fileURLToPath(new URL('../../data/base', import.meta.url));
