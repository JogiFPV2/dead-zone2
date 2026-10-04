import { mountOverlay } from './overlay-stage.js';
import { showSaveConflict } from './session-conflict.js';

/**
 * `?online=mock&screen=conflict|conflict-bare|conflict-exit|gone`: the session-conflict window
 * with the mockup's data (Marta Nowak, day 12 → server day 14) for review. Resolves on either
 * button; the menu follows.
 */
export function previewSaveConflict(
  root: HTMLElement,
  kind: 'conflict' | 'conflict-bare' | 'conflict-exit' | 'gone',
): Promise<void> {
  const overlay = mountOverlay(root, 'dzo--conflict');
  const today = (h: number, m: number): Date => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };
  return new Promise((resolve) => {
    const finish = (): void => {
      document.removeEventListener('keydown', onKey, { capture: true });
      overlay.dispose();
      resolve();
    };
    const dialog = showSaveConflict({
      host: overlay.stage,
      kind: kind === 'gone' ? 'gone' : 'conflict',
      name: 'Marta Nowak',
      female: true,
      // Review screen: the toast stays until closed (in game it hides after 6 s).
      toastMs: 0,
      trigger: kind === 'conflict-exit' ? 'exit' : 'autosave',
      local: { day: 12, minuteOfDay: 6 * 60, savedAt: today(10, 58).getTime() },
      server:
        kind === 'conflict' || kind === 'conflict-exit'
          ? { version: 15, day: 14, minuteOfDay: 11 * 60 + 4, savedAt: today(11, 4).toISOString() }
          : undefined,
      onLoadNewer: finish,
      onMenu: finish,
    });
    function onKey(e: KeyboardEvent): void {
      if (dialog.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
  });
}
