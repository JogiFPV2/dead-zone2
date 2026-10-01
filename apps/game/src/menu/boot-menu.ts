import { AudioEngine } from '../audio/audio-engine.js';
import { createSettingsStore } from '../settings/store.js';
import { createMainMenu, type GameMode } from './main-menu.js';
import type { MenuScene } from './menu-scene.js';

/** Menu soundtrack (CC0, ASSETS.md). */
const TRACK = { title: 'EmptyCity', credit: 'yd · OpenGameArt · CC0' };

/** Menu only when the page has no query (dev/test URLs go straight to the game), or `?menu=1`. */
export function shouldShowMenu(search: string): boolean {
  const q = new URLSearchParams(search);
  const menu = q.get('menu');
  if (menu === '1') return true;
  if (menu === '0') return false;
  return [...q.keys()].length === 0;
}

/**
 * Main menu over a live background scene; resolves when the player starts a game. The menu's
 * renderer, scene and music are torn down before the game boots its own renderer.
 */
export async function runMenu(root: HTMLElement): Promise<{ mode: GameMode; resume: boolean }> {
  const settings = createSettingsStore();
  const audio = new AudioEngine(settings, import.meta.env.BASE_URL);
  audio.preload('ui-click1', 'ui-rollover2', 'ui-switch2');
  audio.playLoop('music', 'menu-emptycity');
  audio.playLoop('ambience', 'amb-crickets');

  let scene: MenuScene | undefined;
  let dimmed = false;
  let started = false;
  void import('./menu-scene.js')
    .then((m) => m.createMenuScene(root, () => settings.get().graphics.style))
    .then((s) => {
      if (started) {
        s.dispose();
        return;
      }
      scene = s;
      s.setDimmed(dimmed);
    })
    .catch((e: unknown) => console.warn('Menu: brak sceny w tle', e));

  const choice = await new Promise<{ mode: GameMode; resume: boolean }>((resolve) => {
    const menu = createMainMenu({
      root,
      settings,
      audio,
      version: `v0.1 demo · build ${__DZ_BUILD_DATE__}`,
      track: TRACK,
      setDimmed(dim) {
        dimmed = dim;
        scene?.setDimmed(dim);
      },
      onStart(c) {
        menu.dispose();
        resolve(c);
      },
    });
  });
  started = true;
  scene?.dispose();
  audio.setInMenu(false);
  audio.stopLoop('music');
  audio.stopLoop('ambience');
  return choice;
}
