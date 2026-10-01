/** Minimal element shape (tests run without a DOM). */
export interface ClosestTarget {
  closest(selector: string): unknown;
}

/**
 * Parts of a window that never count as "outside": the window itself is given per screen;
 * these are shared floating bits (tooltips, menus, buttons) that may sit outside the panels.
 */
export const ALWAYS_INSIDE = [
  'button',
  '[role="menu"]',
  '[role="tooltip"]',
  '.dz-tooltip',
  '.dz-ct',
].join(', ');

/** True when `target` is not within any element matching `inside` (or ALWAYS_INSIDE). */
export function isOutsideClick(target: unknown, inside: string): boolean {
  const t = target as Partial<ClosestTarget> | null;
  if (!t || typeof t.closest !== 'function') return false;
  return !t.closest(inside) && !t.closest(ALWAYS_INSIDE);
}

/**
 * Closes a full-screen window overlay when the user presses on its backdrop (outside the
 * panels matched by `inside`). Decided on `pointerdown`, so a drag that starts on an item and
 * is released over the backdrop never closes it. The press is consumed (no world action, no
 * native context menu). Returns a dispose function.
 */
export function bindOutsideClose(
  overlay: HTMLElement,
  inside: string,
  isOpen: () => boolean,
  close: () => void,
): () => void {
  const onDown = (e: PointerEvent): void => {
    if (!isOpen() || !isOutsideClick(e.target, inside)) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const onMenu = (e: MouseEvent): void => {
    if (isOutsideClick(e.target, inside)) e.preventDefault();
  };
  overlay.addEventListener('pointerdown', onDown);
  overlay.addEventListener('contextmenu', onMenu);
  return () => {
    overlay.removeEventListener('pointerdown', onDown);
    overlay.removeEventListener('contextmenu', onMenu);
  };
}
