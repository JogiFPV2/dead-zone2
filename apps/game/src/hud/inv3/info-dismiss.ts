/**
 * Touch item info window (the inventory tooltip shown on tap): it has no hover to end it, so it
 * closes with ✕, a tap outside, Escape or Back. Back = one history entry pushed while it is open
 * (Android back / browser back pops it); closing it any other way takes that entry back off.
 */
export interface InfoDismiss {
  readonly open: boolean;
  /** The info window was shown (or its content replaced by another item). */
  shown(): void;
  /** ✕ / tap outside / Escape / the inventory closing: hide and drop the history entry. */
  dismiss(): void;
  /** Escape key: true when it closed the info window (the caller consumes the key). */
  escape(): boolean;
}

type HistoryLike = Pick<History, 'pushState' | 'back'>;
type WinLike = Pick<Window, 'addEventListener'>;

export function createInfoDismiss(
  hide: () => void,
  win: WinLike | undefined = typeof window === 'undefined' ? undefined : window,
  history: HistoryLike | undefined = typeof window === 'undefined' ? undefined : window.history,
): InfoDismiss {
  let open = false;
  /** Our history entry is on top of the stack. */
  let pushed = false;
  win?.addEventListener('popstate', () => {
    if (!pushed) return;
    pushed = false;
    if (open) {
      open = false;
      hide();
    }
  });
  const api: InfoDismiss = {
    get open() {
      return open;
    },
    shown() {
      open = true;
      if (!pushed && history) {
        history.pushState({ dzInfo: true }, '');
        pushed = true;
      }
    },
    dismiss() {
      const was = open;
      open = false;
      if (was) hide();
      if (pushed) {
        pushed = false;
        history?.back();
      }
    },
    escape() {
      if (!open) return false;
      api.dismiss();
      return true;
    },
  };
  return api;
}
