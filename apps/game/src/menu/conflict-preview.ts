import { mountOverlay } from './overlay-stage.js';
import { showSaveConflict } from './session-conflict.js';

/**
 * `?online=mock&screen=conflict|conflict-nominute|conflict-bare|conflict-exit|gone`: the
 * session-conflict window with the mockup's data (Marta Nowak, day 12 → server day 14) for review;
 * `conflict-nominute` = server save without `minuteOfDay`, `conflict-bare` = `server: null`. Resolves on either
 * button; the menu follows.
 */
export type ConflictPreview =
  'conflict' | 'conflict-nominute' | 'conflict-bare' | 'conflict-exit' | 'gone';

export function previewSaveConflict(root: HTMLElement, kind: ConflictPreview): Promise<void> {
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
      // `SaveConflictError.server` of Serwer #167.
      server:
        kind === 'conflict-bare'
          ? null
          : {
              version: 15,
              gameDay: 14,
              minuteOfDay: kind === 'conflict-nominute' ? null : 11 * 60 + 4,
              updatedAt: today(11, 4).toISOString(),
            },
      onLoadNewer: finish,
      onMenu: finish,
      // In game NADPISZ SERWER re-sends the refused save (account/cloud-save.ts).
      ...(kind === 'gone' ? {} : { onOverwrite: finish }),
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
