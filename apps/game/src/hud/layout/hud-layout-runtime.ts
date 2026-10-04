/**
 * Game wiring of the HUD layout (deadzone-hud-v2-spec „Edytor HUD”): applies the saved layout
 * of the whole settings object (`PlayerSettingsStore`, `hud`) at start, on every change (local or
 * the cloud copy), on resize and „Skala interfejsu”, and opens the editor from the pause menu.
 */
import type { HudLayout } from '@deadzone/ui/settings';
import type { PlayerSettingsStore } from '../../settings/player-settings-store.js';
import type { SettingsStore } from '../../settings/store.js';
import { createLayoutApplier, type LayoutTargets } from './apply-layout.js';
import { createHudEditor, type HudEditor } from './hud-editor.js';
import { changedSlots } from './hud-layout-model.js';

export interface HudLayoutRuntimeOptions {
  readonly root: HTMLElement;
  readonly player: Pick<PlayerSettingsStore, 'load' | 'save' | 'subscribe'>;
  readonly settings: Pick<SettingsStore, 'get' | 'subscribe'>;
  readonly targets: () => LayoutTargets;
  /** Sample content in calm-hidden elements while editing (Hud.setEditPreview). */
  readonly setPreview: (on: boolean) => void;
  readonly window?: Window;
}

export interface HudLayoutRuntime {
  /** Opens the editor on `layout`; `done(true)` after Zapisz (saved), `done(false)` after Anuluj. */
  openEditor(layout: HudLayout, done: (saved: boolean) => void): HudEditor;
  readonly editing: boolean;
  dispose(): void;
}

export function installHudLayout(o: HudLayoutRuntimeOptions): HudLayoutRuntime {
  const win = o.window ?? window;
  const applier = createLayoutApplier(o.root, o.targets);
  let editor: HudEditor | undefined;
  const applySaved = (): void => {
    if (!editor) applier.apply(o.player.load().hud);
  };
  applySaved();
  const unsubPlayer = o.player.subscribe(applySaved);
  // „Skala interfejsu” changes the HUD size: clamp again after the stylesheet var updated.
  const unsubSettings = o.settings.subscribe((n, p) => {
    if (n.graphics.uiScale !== p.graphics.uiScale)
      win.requestAnimationFrame(() => applier.reclamp());
  });
  const onResize = (): void => applier.reclamp();
  win.addEventListener('resize', onResize);
  // Content-sized blocks (status, item log) grow and shrink: keep custom ones on screen.
  const timer = win.setInterval(() => {
    if (!editor && changedSlots(applier.layout).length) applier.reclamp();
  }, 1000);

  function toastSaved(): void {
    const t = o.root.ownerDocument.createElement('div');
    t.className = 'dz-hed-toast';
    t.setAttribute('role', 'status');
    t.textContent = '✓ Układ HUD zapisany';
    o.root.appendChild(t);
    win.setTimeout(() => t.remove(), 2600);
  }

  return {
    get editing() {
      return editor !== undefined;
    },
    openEditor(layout, done) {
      editor?.dispose();
      const finish = (saved: boolean): void => {
        editor = undefined;
        applySaved();
        done(saved);
      };
      editor = createHudEditor({
        root: o.root,
        layout,
        applier,
        uiScale: o.settings.get().graphics.uiScale,
        setPreview: o.setPreview,
        onSave(hud) {
          const r = o.player.save({ ...o.player.load(), hud });
          if (r.ok) toastSaved();
          else console.warn('Układ HUD nie został zapisany', r);
          finish(r.ok);
        },
        onCancel: () => finish(false),
      });
      return editor;
    },
    dispose() {
      editor?.dispose();
      editor = undefined;
      unsubPlayer();
      unsubSettings();
      win.removeEventListener('resize', onResize);
      win.clearInterval(timer);
    },
  };
}
