import type { FootprintCatalog } from './footprint-for-id.js';

interface SurfaceFields {
  surfaceHeightM?: number;
  onSurface?: boolean;
  placeable?: { surfaceHeightM?: number; onSurface?: boolean };
}

const fieldsOf = (catalog: FootprintCatalog, contentId: string): SurfaceFields | undefined => {
  const c = catalog.containers[contentId] as SurfaceFields | undefined;
  return c ?? (catalog.items[contentId] as SurfaceFields | undefined)?.placeable;
};

/**
 * Wysokość blatu obiektu mapy (m): typ schowka `surfaceHeightM`, potem przedmiot
 * `placeable.surfaceHeightM`. Brak = nie ma blatu (`undefined`).
 */
export function surfaceHeightForId(
  catalog: FootprintCatalog,
  contentId: string,
): number | undefined {
  return fieldsOf(catalog, contentId)?.surfaceHeightM;
}

/** Obiekt stoi na blacie mebla pod spodem (`placeable.onSurface`), np. telewizor, radio, lampka. */
export function onSurfaceForId(catalog: FootprintCatalog, contentId: string): boolean {
  return (catalog.items[contentId] as SurfaceFields | undefined)?.placeable?.onSurface === true;
}
