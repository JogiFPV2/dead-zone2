import './inventory-v2-mobile.css';

/** Class on <html> that turns on the inventory v2 phone layout (inventory-v2-spec, not approved). */
export const INV2_CLASS = 'dz-inv2';

/** `?inv=v2` turns the inventory v2 layout on; default off until Paweł approves it. */
export function inventoryV2Enabled(search: string): boolean {
  return new URLSearchParams(search).get('inv') === 'v2';
}
