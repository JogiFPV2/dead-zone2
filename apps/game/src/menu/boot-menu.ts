import { AudioEngine } from '../audio/audio-engine.js';
import { SlotsFullError } from '../characters/character-store.js';
import { characterStore } from '../characters/open-store.js';
import { newSession, sessionOf } from '../characters/sessions.js';
import { parseBootOptions } from '../boot-options.js';
import type { GameSession } from '../session.js';
import { continueLabel } from './characters-model.js';
import { createSettingsStore } from '../settings/store.js';
import { createMainMenu, type GameMode, type MenuStart } from './main-menu.js';
import type { MenuScene } from './menu-scene.js';
import { MENU_TRACK as TRACK } from './track.js';

/** Menu only when the page has no query (dev/test URLs go straight to the game), or `?menu=1`. */
export function shouldShowMenu(search: string): boolean {
  const q = new URLSearchParams(search);
  const menu = q.get('menu');
  if (menu === '1') return true;
  if (menu === '0') return false;
  return [...q.keys()].length === 0;
}

/** Map of a new character's world: the page's default (prod: test-town; dev: test map). */
const newWorldMap = (): string => parseBootOptions('').map;

const MODE_LABELS: Record<GameMode, string> = { survive: 'Przetrwaj', rescue: 'Ratunek' };

/**
 * Main menu over a live background scene; resolves with the character to play (Kontynuuj, Graj
 * on Postacie, or a new one from the creator). The menu's renderer, scene and music are torn
 * down before the game boots its own renderer.
 */
export async function runMenu(root: HTMLElement): Promise<GameSession> {
  const store = await characterStore();
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

  const showMenu = (o: {
    continueInfo?: string | undefined;
    slotsFull: boolean;
    startView?: 'characters' | undefined;
  }) =>
    new Promise<MenuStart>((resolve) => {
      const menu = createMainMenu({
        root,
        settings,
        audio,
        version: `v0.1 demo · build ${__DZ_BUILD_DATE__}`,
        track: TRACK,
        continueInfo: o.continueInfo,
        characters: store,
        slotsFull: o.slotsFull,
        ...(o.startView ? { startView: o.startView } : {}),
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
  let session: GameSession | undefined;
  let startView: 'characters' | undefined;
  while (!session) {
    const recent = await store.mostRecentAlive();
    const c = await showMenu({
      continueInfo: recent ? continueLabel(recent, Date.now()) : undefined,
      slotsFull: (await store.freeSlots()) <= 0,
      startView,
    });
    startView = undefined;
    if (c.kind === 'continue' && recent) session = await sessionOf(store, recent);
    else if (c.kind === 'play') session = await sessionOf(store, c.character);
    else if (c.kind === 'new') {
      // New game: the creator over the dimmed menu scene; Esc goes back to the menu.
      dimmed = true;
      scene?.setDimmed(true);
      const { runCreator } = await import('../creator/run-creator.js');
      const created = await runCreator({ root, modeLabel: MODE_LABELS[c.mode], audio });
      dimmed = false;
      scene?.setDimmed(false);
      if (!created) {
        if (c.from === 'characters') startView = 'characters';
        continue;
      }
      try {
        session = await newSession(store, created, { map: newWorldMap(), mode: c.mode });
      } catch (e) {
        if (!(e instanceof SlotsFullError)) throw e;
        startView = 'characters';
      }
    }
  }
  started = true;
  scene?.dispose();
  audio.setInMenu(false);
  audio.stopLoop('music');
  audio.stopLoop('ambience');
  return session;
}
