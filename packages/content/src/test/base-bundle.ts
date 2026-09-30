import { buildContentBundle } from '../bundle/build-content-bundle.js';
import type { ContentBundle } from '../bundle/content-bundle.js';
import { BASE_PACK_DIR, readPackDir } from '../node/index.js';

let cached: Promise<ContentBundle> | undefined;

/** Bundle paczki bazowej, budowany raz na plik testów. */
export function baseBundle(): Promise<ContentBundle> {
  cached ??= readPackDir(BASE_PACK_DIR).then((p) => buildContentBundle([p]));
  return cached;
}

/** Minuty gry do przekroczenia progu przy stałym tempie. */
export const minutesTo = (threshold: number, perMin: number) => threshold / perMin;

export const DAY_MIN = 24 * 60;
