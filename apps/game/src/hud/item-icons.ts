/**
 * Raster item icons baked from the 3D models (`pnpm --filter @deadzone/assets assets icons` →
 * `public/icons/`). Items without one keep the vector icon from `@deadzone/ui`.
 */
let icons: ReadonlyMap<string, string> = new Map();

/** Item content id → icon URL, or undefined (use the vector icon). */
export const itemImage = (defId: string): string | undefined => icons.get(defId);

/** Parses `icons/index.json` (item id → file) into absolute URLs under `base`. */
export function parseIconIndex(raw: unknown, base: string): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, file] of Object.entries(raw)) {
    if (typeof file === 'string' && /^[a-z0-9-]+\.png$/.test(file)) out.set(id, `${base}${file}`);
  }
  return out;
}

/** Loads the icon index once (failures leave the vector icons). */
export async function loadItemIcons(base = `${import.meta.env.BASE_URL}icons/`): Promise<void> {
  try {
    const res = await fetch(`${base}index.json`);
    if (res.ok) icons = parseIconIndex(await res.json(), base);
  } catch (e) {
    console.warn('item icons unavailable, vector icons stay', e);
  }
}

/** Test hook. */
export function setItemIcons(map: ReadonlyMap<string, string>): void {
  icons = map;
}
