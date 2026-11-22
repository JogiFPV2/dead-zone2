import type { StealthLevel } from '@deadzone/protocol';

export interface StealthEyeVM {
  /** `SimViewPatch.stealth`; undefined = the sim has not sent it yet (eye hidden). */
  level: StealthLevel | undefined;
  /** 0..1 (`SimViewPatch.visibility`). */
  visibility: number;
}

export interface StealthEye {
  readonly el: HTMLElement;
  update(vm: StealthEyeVM): void;
}

/** Label per level (tooltip and screen readers). */
export const STEALTH_LABEL: Readonly<Record<StealthLevel, string>> = {
  lit: 'Widoczny',
  dim: 'Słabo widoczny',
  hidden: 'Ukryty',
};

/** Eye outline: open (lit), half shut (dim), shut with a lash line (hidden). */
const EYE: Readonly<Record<StealthLevel, string>> = {
  lit: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3.2" class="dz-eye3__pupil"/>',
  dim: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" class="dz-eye3__faint"/><path d="M2 12h20" /><path d="M5 12a7 4 0 0 0 14 0" /><circle cx="12" cy="13.4" r="2.2" class="dz-eye3__pupil"/>',
  hidden:
    '<path d="M3 11c2.4 3 5.4 4.5 9 4.5s6.6-1.5 9-4.5"/><path d="M7 14.5 5.6 17M12 15.5V18.4M17 14.5l1.4 2.5"/>',
};

/**
 * HUD v3 visibility eye (Pawel 2026-11-21, docs 9.45): how well zombies (and later other
 * players) can see the character, from the sim's `stealth` / `visibility`. Bottom left above
 * the HP bar; open eye in the light, half shut in the shade, shut when hidden, with a thin bar of
 * the visibility (0..100 %).
 */
export function createStealthEye(): StealthEye {
  const el = document.createElement('div');
  el.className = 'dz-eye3';
  el.hidden = true;
  el.setAttribute('role', 'status');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('dz-eye3__icon');
  const track = document.createElement('span');
  track.className = 'dz-eye3__track';
  const fill = document.createElement('i');
  fill.className = 'dz-eye3__fill';
  track.append(fill);
  el.append(icon, track);
  let lastLevel: StealthLevel | undefined;
  let lastPct = NaN;
  return {
    el,
    update({ level, visibility }) {
      if (!level) {
        el.hidden = true;
        lastLevel = undefined;
        return;
      }
      el.hidden = false;
      if (level !== lastLevel) {
        lastLevel = level;
        icon.innerHTML = EYE[level];
        el.dataset.level = level;
        el.setAttribute('aria-label', STEALTH_LABEL[level]);
        el.title = STEALTH_LABEL[level];
      }
      const pct = Math.round(Math.max(0, Math.min(1, visibility)) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        fill.style.transform = `scaleX(${pct / 100})`;
      }
    },
  };
}
