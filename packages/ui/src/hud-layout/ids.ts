/**
 * HUD elements as named by the client (agreed with Silnik). The weapon panel and the vehicle
 * panel share one place on screen, so the layout has one slot for both: `weapon`.
 */
export const HUD_ELEMENT_IDS = [
  'minimap',
  'topbar',
  'status',
  'hotbar',
  'itemlog',
  'weapon',
  'vehicle',
  'threat',
  'hints',
] as const;

export type HudElementId = (typeof HUD_ELEMENT_IDS)[number];

/** Layout keys: every element id except `vehicle` (it uses the `weapon` slot). */
export const HUD_LAYOUT_SLOTS = [
  'minimap',
  'topbar',
  'status',
  'hotbar',
  'itemlog',
  'weapon',
  'threat',
  'hints',
] as const satisfies readonly HudElementId[];

export type HudLayoutSlot = (typeof HUD_LAYOUT_SLOTS)[number];

export function isHudElementId(id: string): id is HudElementId {
  return (HUD_ELEMENT_IDS as readonly string[]).includes(id);
}

/** Layout slot that positions an element (`vehicle` → `weapon`). */
export function layoutSlotFor(id: HudElementId): HudLayoutSlot {
  return id === 'vehicle' ? 'weapon' : id;
}
