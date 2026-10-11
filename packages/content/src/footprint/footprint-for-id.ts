import type { Footprint } from '../schemas/common/footprint.js';
import { footprintOf } from './footprint-of.js';

/** Fragment `ContentBundle` potrzebny do rozmiaru obiektu mapy. */
export interface FootprintCatalog {
  readonly containers: Readonly<Record<string, object>>;
  readonly items: Readonly<Record<string, object>>;
}

/**
 * Rozmiar obiektu mapy po `contentId`: najpierw typ schowka, potem przedmiot `placeable`
 * (test paczki pilnuje, że oba mówią to samo). Nieznane id = 1×1.
 */
export function footprintForId(catalog: FootprintCatalog, contentId: string): Footprint {
  return footprintOf(catalog.containers[contentId] ?? catalog.items[contentId]);
}
