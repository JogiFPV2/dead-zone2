import type { FurnitureActionView, FurnitureView } from '@deadzone/protocol';

/**
 * Furniture / edge context menu (deadzone-hud-v2-spec „Meble i czynności (UI)”), protocol 26:
 * `SimViewPatch.furnitureActions` lists what is in reach with every action (enabled or not,
 * reason code + Polish text) and `useFurniture {furnitureId, actionId}` runs one. Generic over
 * `typeId` (`door`, `window`, `gate`, `fridge`, `tv`, …): the client only picks a name / icon
 * by `typeId` and an icon by `reason`, everything else comes from the sim.
 *
 * Actions that use a carried item are `<action>:<itemId>` with `item`: grouped into a submenu.
 */
export type { FurnitureActionView, FurnitureView };

/** Tile on the sim grid (`@deadzone/content/footprint` `TileXY`). */
export interface FurnTile {
  x: number;
  y: number;
}

/**
 * Where the menu gets its entries and how it runs them (`SimFurnitureSource`: the sim's list
 * plus client-only entries the sim does not list yet, e.g. sleeping on a bed).
 */
export interface FurnitureSource {
  /** Entry under sim point (`x`, `y`) on floor `z`; undefined = nothing there. */
  at(x: number, y: number, z: number): FurnitureView | undefined;
  /** The current version of an entry (refresh while the menu is open); undefined = gone. */
  byId(furnitureId: number): FurnitureView | undefined;
  /** Runs the action (`useFurniture`). */
  use(view: FurnitureView, actionId: string): void;
}

/**
 * Features the sim does not simulate yet (spec [ZAŁ.]) or that Paweł has not approved: their UI
 * is not rendered at all. Flip one to true together with the sim / design PR.
 */
export const FURNITURE_FEATURES = {
  /** Freezer compartment („Otwórz: zamrażarka”), freezer section of the fridge window. */
  freezer: false,
  /** Radio („Słuchaj radia”, radio panel). */
  radio: false,
  /** Sleep length (Do rana / 1 / 2 / 4 / 8 h): `SleepCommand` has no duration. */
  sleepDuration: false,
  /** Generators (power source chip, „PRĄD · GENERATOR”). */
  generator: false,
} as const;

export type FurnitureFeature = keyof typeof FURNITURE_FEATURES;

/** Action ids / labels / type ids that belong to a feature that is switched off. */
const FEATURE_ACTIONS: Record<FurnitureFeature, RegExp> = {
  freezer: /freez|zamra[zż]/i,
  radio: /radio/i,
  sleepDuration: /^sleep-(\d+h|until|morning)/i,
  generator: /generator/i,
};

/** True when the action / object belongs to a feature that is off (not rendered). */
export function hiddenByFeature(
  id: string,
  features: Readonly<Record<FurnitureFeature, boolean>> = FURNITURE_FEATURES,
): boolean {
  return (Object.keys(FEATURE_ACTIONS) as FurnitureFeature[]).some(
    (f) => !features[f] && FEATURE_ACTIONS[f].test(id),
  );
}
