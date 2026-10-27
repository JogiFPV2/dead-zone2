import { createConfirm } from '../menu/confirm-dialog.js';
import { mountOverlay } from '../menu/overlay-stage.js';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Polish reason of a failed load (sim `SaveError` messages are English, `save/save.ts`). A save
 * from an older map generator (`generator-version`, e.g. before GENERATOR_REV 18) cannot be read.
 */
export function loadErrorText(message: string): string {
  if (/world generator v\d+|generator-version/.test(message))
    return 'Ten zapis pochodzi ze starej wersji mapy i nie można go wczytać.';
  if (/world seed/.test(message)) return 'Ten zapis pochodzi z innego świata (inne ziarno mapy).';
  if (/not a Deadzone save/.test(message)) return 'To nie jest zapis gry Deadzone.';
  if (/unsupported version/.test(message))
    return 'Ta wersja gry nie obsługuje tego formatu zapisu.';
  return message;
}

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
    body: `Zapis postaci „${esc(name)}” nie pasuje do tej wersji gry.<br><span class="dzo-danger">${esc(loadErrorText(message))}</span>`,
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
