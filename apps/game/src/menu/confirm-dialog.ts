import { icon } from './icons.js';
import { keyBadge } from './overlay-stage.js';

export interface ConfirmOptions {
  /** The overlay stage the dialog covers. */
  readonly host: HTMLElement;
  readonly title: string;
  /** Trusted HTML (static strings only). */
  readonly body: string;
  readonly yes: string;
  readonly no?: string;
  /** Initial focus on the confirming button (default: on Anuluj). */
  readonly focusYes?: boolean;
  /** Destructive action (characters-delete.png): red confirm button and icon. */
  readonly danger?: boolean;
  /** Icon name (icons.ts); default `warning`. */
  readonly icon?: string;
  onAnswer(yes: boolean): void;
}

export interface ConfirmDialog {
  /** Routes a keydown; true when handled. Esc = no, Enter = yes, ←/→/Tab move the focus. */
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

/** Confirmation dialog (mockup pause-confirm.png) over an overlay stage. */
export function createConfirm(o: ConfirmOptions): ConfirmDialog {
  const el = document.createElement('div');
  el.className = o.danger ? 'dzo-confirm dzo-confirm--danger' : 'dzo-confirm';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-label', o.title);
  o.host.appendChild(el);
  let focusYes = o.focusYes ?? false;
  let done = false;

  const answer = (yes: boolean): void => {
    if (done) return;
    done = true;
    el.remove();
    o.onAnswer(yes);
  };
  const render = (): void => {
    el.innerHTML = `<div class="dzo-panel dzo-confirm-box">
<div class="dzo-confirm-icon">${icon(o.icon ?? 'warning', o.danger ? 32 : 34)}</div>
<div class="dzo-confirm-title">${o.title}</div>
<div class="dzo-confirm-body">${o.body}</div>
<div class="dzo-sep"></div>
<div class="dzo-confirm-foot"><button type="button" class="dzo-btn dzo-btn--sec${focusYes ? '' : ' dzo-btn--focus'}" data-answer="no">${o.no ?? 'ANULUJ'} ${keyBadge('ESC')}</button><button type="button" class="dzo-btn ${o.danger ? 'dzo-btn--danger' : 'dzo-btn--pri'}${focusYes ? ' dzo-btn--focus' : ''}" data-answer="yes">${o.yes} ${keyBadge('ENTER', true)}</button></div>
</div>`;
    el.querySelector<HTMLElement>('.dzo-btn--focus')?.focus({ preventScroll: true });
  };
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-answer]')?.dataset.answer;
    if (a) answer(a === 'yes');
  });
  render();

  return {
    onKey(e) {
      if (done) return false;
      const c = e.code;
      if (c === 'Escape') answer(false);
      else if (c === 'Enter' || c === 'NumpadEnter') answer(true);
      else if (c === 'Space') answer(focusYes);
      else if (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'Tab') {
        focusYes = !focusYes;
        render();
      } else return false;
      return true;
    },
    dispose() {
      done = true;
      el.remove();
    },
  };
}
