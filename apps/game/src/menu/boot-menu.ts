import type { ConflictPreview } from './conflict-preview.js';
import { AudioEngine } from '../audio/audio-engine.js';
import { SlotsFullError } from '../characters/character-store.js';
import { characterStore } from '../characters/open-store.js';
import { newSession, sessionOf } from '../characters/sessions.js';
import { parseBootOptions } from '../boot-options.js';
import { LocalPlayerSettingsStore } from '../settings/player-settings-store.js';
import type { GameSession } from '../session.js';
import { continueLabel } from './characters-model.js';
import { createSettingsStore } from '../settings/store.js';
import { createMainMenu, type GameMode, type MenuStart } from './main-menu.js';
import type { MenuScene } from './menu-scene.js';
import { MENU_TRACK as TRACK } from './track.js';
import { bindUiScale } from '../ui/ui-scale.js';
import { AccountSession } from '../account/account-session.js';
import { resolveAccountApi } from '../account/resolve.js';
import { displayName } from '../characters/display-name.js';
import { portraitOf } from '../characters/portrait.js';

/** Query keys that keep the menu (online review flags), unlike dev/test game URLs. */
const MENU_KEYS = new Set(['menu', 'online', 'as', 'chars', 'save', 'net', 'screen']);

/** Menu only when the page has no query (dev/test URLs go straight to the game), or `?menu=1`. */
export function shouldShowMenu(search: string): boolean {
  const q = new URLSearchParams(search);
  const menu = q.get('menu');
  if (menu === '1') return true;
  if (menu === '0') return false;
  // Debug `?menuTime=` / `?menuSpeed=` only make sense on the menu.
  if (q.has('menuTime') || q.has('menuSpeed')) return true;
  return [...q.keys()].every((k) => MENU_KEYS.has(k));
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Online preview without the cloud save pipeline (Serwer's DZSV upload is not wired yet). */
const CLOUD_PLAY_NOTE =
  'Podgląd konta: gra z zapisu w chmurze ruszy po podłączeniu serwera zapisów.';

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
  // The menu store applies „Skala interfejsu” until the game binds its own.
  const unbindUiScale = bindUiScale(settings);
  // Konto: offline by default; `?online=mock` = demo account (account/resolve.ts).
  const account = new AccountSession({
    api: resolveAccountApi(window.location.search),
    settings: new LocalPlayerSettingsStore(settings, localStorageOrUndefined()),
    storage: localStorageOrUndefined(),
  });
  await account.restore().catch((e: unknown) => console.warn('Konto: brak sesji', e));
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
    startView?: 'characters' | 'login' | 'account' | undefined;
    charactersNote?: string | undefined;
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
        charactersNote: o.charactersNote,
        account,
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
  const screen = new URLSearchParams(window.location.search).get('screen');
  if (
    account.online &&
    screen &&
    /^(conflict|conflict-nominute|conflict-bare|conflict-exit|gone)$/.test(screen)
  ) {
    // Review: the session-conflict window over the menu scene (in game it follows a 409 / 410).
    const { previewSaveConflict } = await import('./conflict-preview.js');
    await previewSaveConflict(root, screen as ConflictPreview);
  }
  let session: GameSession | undefined;
  // First start online without a session (and without „Graj offline”): Logowanie.
  let startView: 'characters' | 'login' | 'account' | undefined =
    screen === 'login' || screen === 'chars' || screen === 'account'
      ? screen === 'chars'
        ? 'characters'
        : screen
      : account.needsLogin
        ? 'login'
        : undefined;
  let charactersNote: string | undefined;
  while (!session) {
    const recent = await store.mostRecentAlive();
    const c = await showMenu({
      continueInfo: recent ? continueLabel(recent, Date.now()) : undefined,
      slotsFull: (await store.freeSlots()) <= 0,
      startView,
      charactersNote,
    });
    startView = undefined;
    charactersNote = undefined;
    if (c.kind === 'cloud-play') {
      // TODO(cloud saves): open + download the DZSV save (`POST …/open`), then boot the game.
      startView = 'characters';
      charactersNote = CLOUD_PLAY_NOTE;
    } else if (c.kind === 'cloud-new') {
      dimmed = true;
      scene?.setDimmed(true);
      const { runCreator } = await import('../creator/run-creator.js');
      const created = await runCreator({ root, modeLabel: MODE_LABELS[c.mode], audio });
      dimmed = false;
      scene?.setDimmed(false);
      startView = 'characters';
      if (!created) continue;
      const { firstName, lastName } = created.spec;
      const r = await account.api.createCharacter({
        name: displayName(firstName, lastName),
        appearance: { portrait: portraitOf(created.look), spec: created.spec },
        worldSettings: { map: newWorldMap(), mode: c.mode },
      });
      charactersNote = r.ok
        ? CLOUD_PLAY_NOTE
        : r.reason === 'error' && r.code === 'alive_character_limit'
          ? 'Limit żywych postaci na koncie: usuń postać, aby zacząć nową grę.'
          : 'Nie udało się założyć postaci na koncie. Spróbuj ponownie.';
    } else if (c.kind === 'continue' && recent) session = await sessionOf(store, recent);
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
  unbindUiScale();
  audio.setInMenu(false);
  audio.stopLoop('music');
  audio.stopLoop('ambience');
  return session;
}
