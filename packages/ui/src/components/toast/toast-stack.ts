import { defaultDoc, el, setData, type Doc } from '../../dom/h.js';
import { flip } from '../../dom/flip.js';
import { createToast } from './toast.js';
import {
  isExpired,
  pushToast,
  TOAST_EXIT_MS,
  TOAST_LIFETIME_MS,
  type ToastInput,
  type ToastVM,
} from './model.js';

export interface ToastStackOptions {
  /** Clock for createdAt / merging (default `Date.now`). */
  now?: () => number;
}

export interface ToastStack {
  readonly el: HTMLElement;
  /** Shows a toast (sim event, loot, …). Returns the created or merged toast. */
  push(input: ToastInput): ToastVM;
  /** Visible toasts, newest first. */
  readonly toasts: readonly ToastVM[];
  /** Removes everything at once (e.g. death screen). */
  clear(): void;
  destroy(): void;
}

interface Entry {
  vm: ToastVM;
  update(vm: ToastVM): void;
  node: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Toast stack (spec §3.4, anchored top right under the minimap): newest on top, max 4 visible,
 * identical toasts within 1 s merge, lifetime per kind, the rest slide into place (FLIP).
 */
export function createToastStack(
  opts: ToastStackOptions = {},
  doc: Doc = defaultDoc(),
): ToastStack {
  const now = opts.now ?? Date.now;
  const root = el(doc, 'div', 'dz-toasts');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  let list: ToastVM[] = [];
  const entries = new Map<string, Entry>();
  let seq = 0;

  const leave = (id: string): void => {
    const e = entries.get(id);
    if (!e) return;
    clearTimeout(e.timer);
    entries.delete(id);
    list = list.filter((t) => t.id !== id);
    setData(e.node, 'enter', false);
    setData(e.node, 'exit', true);
    setTimeout(() => flip(root, () => e.node.remove()), TOAST_EXIT_MS);
  };
  const schedule = (vm: ToastVM): ReturnType<typeof setTimeout> =>
    setTimeout(() => {
      if (isExpired(vm, now())) leave(vm.id);
    }, TOAST_LIFETIME_MS[vm.kind]);

  const push = (input: ToastInput): ToastVM => {
    const r = pushToast(list, input, now(), `t${++seq}`);
    list = r.list;
    for (const t of r.evicted) leave(t.id);
    const existing = entries.get(r.toast.id);
    if (r.merged && existing) {
      clearTimeout(existing.timer);
      existing.update(r.toast);
      existing.vm = r.toast;
      existing.timer = schedule(r.toast);
      return r.toast;
    }
    const t = createToast(r.toast, doc);
    setData(t.el, 'enter', true);
    t.el.addEventListener('animationend', (ev) => {
      if (ev.animationName === 'dz-toast-in' || ev.animationName === 'dz-fade-in')
        setData(t.el, 'enter', false);
    });
    entries.set(r.toast.id, {
      vm: r.toast,
      update: (vm) => t.update(vm),
      node: t.el,
      timer: schedule(r.toast),
    });
    flip(root, () => root.prepend(t.el));
    return r.toast;
  };

  const clear = (): void => {
    for (const e of entries.values()) clearTimeout(e.timer);
    entries.clear();
    list = [];
    root.replaceChildren();
  };

  return {
    el: root,
    push,
    get toasts() {
      return list;
    },
    clear,
    destroy: () => {
      clear();
      root.remove();
    },
  };
}
