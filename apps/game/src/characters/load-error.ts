import { createConfirm } from '../menu/confirm-dialog.js';
import { mountOverlay } from '../menu/overlay-stage.js';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * The character's save did not load (e.g. made by an incompatible build): say so and go back
 * to the menu. The character and its slot are left untouched.
 */
export function showLoadError(root: HTMLElement, name: string, message: string): void {
  const overlay = mountOverlay(root, 'dzo--load-error');
  const back = (): void => window.location.assign(window.location.pathname);
  const dialog = createConfirm({
    host: overlay.stage,
    title: 'NIE MOŻNA WCZYTAĆ ZAPISU',
    body: `Zapis postaci „${esc(name)}” nie pasuje do tej wersji gry.<br><span class="dzo-danger">${esc(message)}</span>`,
    yes: 'MENU GŁÓWNE',
    no: 'WSTECZ',
    focusYes: true,
    onAnswer: back,
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (dialog.onKey(e)) e.preventDefault();
    },
    { capture: true },
  );
}
