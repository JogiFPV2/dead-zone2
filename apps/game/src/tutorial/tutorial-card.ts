import './tutorial-card.css';
import type { TutorialHint } from './tutorial-model.js';

export interface TutorialCard {
  show(hint: TutorialHint | undefined): void;
  /** × pressed: the caller marks the hint done. */
  onDismiss(fn: () => void): void;
}

/** Top-centre hint card of the tutorial (under the top bar), one hint at a time. */
export function createTutorialCard(root: HTMLElement): TutorialCard {
  const el = document.createElement('div');
  el.className = 'dz-tutorial';
  el.setAttribute('role', 'status');
  el.hidden = true;
  const label = document.createElement('div');
  label.className = 'dz-tutorial__label';
  label.textContent = 'SAMOUCZEK';
  const title = document.createElement('div');
  title.className = 'dz-tutorial__title';
  const text = document.createElement('div');
  text.className = 'dz-tutorial__text';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'dz-tutorial__close';
  close.setAttribute('aria-label', 'Zamknij podpowiedź');
  close.textContent = '×';
  el.append(label, title, text, close);
  root.append(el);
  let shown = '';
  let dismiss: (() => void) | undefined;
  close.addEventListener('click', () => dismiss?.());
  return {
    show(hint) {
      const key = hint ? `${hint.id}\n${hint.text}` : '';
      if (key === shown) return;
      shown = key;
      el.hidden = !hint;
      if (!hint) return;
      title.textContent = hint.title;
      text.textContent = hint.text;
    },
    onDismiss(fn) {
      dismiss = fn;
    },
  };
}
