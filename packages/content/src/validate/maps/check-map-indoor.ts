import { CHUNK_SIZE } from '../../schemas/map/constants.js';
import type { MapChunk } from '../../schemas/map/chunk.js';
import type { ContentIndex } from '../content-index.js';

/** Tag kafla podłogi „na dworze” (trawa, asfalt, chodnik…). */
export const OUTDOOR_FLOOR_TAG = 'base:outdoor';
/** Tag obiektu (schowka albo przedmiotu placeable), który wolno postawić na dworze. */
export const OUTDOOR_OK_TAG = 'base:outdoor-ok';

/**
 * Meble tylko w środku: obiekt bez tagu {@link OUTDOOR_OK_TAG} musi stać w pomieszczeniu
 * (`room` ≠ 0) na podłodze bez tagu {@link OUTDOOR_FLOOR_TAG} — szafa nie stoi na trawie.
 * Zwraca opis błędu albo `undefined`.
 */
export function indoorProblem(
  chunk: MapChunk,
  o: { contentId: string; x: number; y: number },
  tags: readonly string[] | undefined,
  index: ContentIndex,
): string | undefined {
  if (tags?.includes(OUTDOOR_OK_TAG)) return undefined;
  const i = o.y * CHUNK_SIZE + o.x;
  const floor = chunk.layers.floor[i] ?? 0;
  let where: string | undefined;
  if (floor === 0) where = 'bez podłogi';
  else if ((chunk.layers.room?.[i] ?? 0) === 0) where = 'poza pomieszczeniem';
  else {
    const id = chunk.palette[floor - 1];
    if (id && index.get('tile', id)?.data.tags.includes(OUTDOOR_FLOOR_TAG))
      where = `na podłodze zewnętrznej „${id}”`;
  }
  if (!where) return undefined;
  return (
    `obiekt „${o.contentId}” na kaflu (${o.x}, ${o.y}) stoi ${where} — ` +
    `meble tylko w pomieszczeniach (albo tag ${OUTDOOR_OK_TAG})`
  );
}
