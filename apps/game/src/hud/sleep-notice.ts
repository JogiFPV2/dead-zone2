import './sleep-notice.css';
import type { NoticeIcon, NoticeVM } from './sleep-feedback.js';

/** How long a notice card stays (mockup states A–C); the success card also has `OK`. */
export const NOTICE_MS = 7000;

const ICON: Record<NoticeIcon, string> = { block: '⊘', alarm: '!', save: '✓', moon: '☾' };

export interface SleepNotice {
  show(vm: NoticeVM): void;
  hide(): void;
}

/** Bottom-centre notice card (sleep refused, interrupted sleep, saved game). */
export function createSleepNotice(root: HTMLElement): SleepNotice {
  const el = document.createElement('div');
  el.className = 'dz-notice';
  el.setAttribute('role', 'status');
  el.hidden = true;
  root.append(el);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = (): void => {
    clearTimeout(timer);
    el.hidden = true;
  };
  return {
    show(vm) {
      clearTimeout(timer);
      el.dataset.tone = vm.tone;
      const icon = document.createElement('div');
      icon.className = 'dz-notice__icon';
      icon.textContent = ICON[vm.icon];
      const text = document.createElement('div');
      text.className = 'dz-notice__text';
      const title = document.createElement('div');
      title.className = 'dz-notice__title';
      title.textContent = vm.title;
      const detail = document.createElement('div');
      detail.className = 'dz-notice__detail';
      detail.textContent = vm.detail;
      text.append(title, detail);
      el.replaceChildren(icon, text);
      if (vm.dismissable) {
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'dz-notice__ok';
        ok.textContent = 'OK';
        ok.addEventListener('click', hide);
        el.append(ok);
      }
      el.hidden = false;
      timer = setTimeout(hide, NOTICE_MS);
    },
    hide,
  };
}
