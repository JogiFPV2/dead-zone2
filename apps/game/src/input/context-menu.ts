/** The browser's own context menu only in text fields (copy / paste); everywhere else the game's. */
export function allowsNativeContextMenu(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return (
    !!el && (el.isContentEditable === true || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
  );
}
