import type { SaveInput } from '../characters/character-store.js';
import type { SlotMeta } from '../characters/session-saver.js';
import type { GameSession } from '../session.js';
import type { PlayerSettingsStore, CloudAttachable } from '../settings/player-settings-store.js';
import { CloudSaver, type CloudWriteResult } from './cloud-save.js';
import { startSettingsSync } from './settings-sync.js';

/** Where the menu goes after the game left for it (one-shot, `sessionStorage`). */
export const CLOUD_RETURN_KEY = 'deadzone.cloud.return';
export type CloudReturn = { view: 'characters' } | { play: string };

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStorageOrUndefined(): SessionStorageLike | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Reads and clears the menu's return target. */
export function takeCloudReturn(
  storage: SessionStorageLike | undefined = sessionStorageOrUndefined(),
): CloudReturn | undefined {
  try {
    const raw = storage?.getItem(CLOUD_RETURN_KEY);
    storage?.removeItem(CLOUD_RETURN_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<{ view: string; play: string }>) : undefined;
    if (typeof v?.play === 'string' && v.play) return { play: v.play };
    if (v?.view === 'characters') return { view: 'characters' };
  } catch {
    // Storage disabled / bad value: plain menu.
  }
  return undefined;
}

/** Menu URL that keeps the account mode (`?online=1`, mock review params). */
export function menuUrlOf(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of ['online', 'as']) {
    const v = q.get(k);
    if (v) keep.set(k, v);
  }
  const s = keep.toString();
  return s ? `${pathname}?${s}` : pathname;
}

export interface CloudPlayHost {
  /** Conflict window: the game is paused until the player picks. */
  setPaused(paused: boolean): void;
  /** The 1280×720 overlay layer the window covers (container of the game). */
  readonly root: HTMLElement;
  /** Leaves the game for the menu (page navigation in the game). */
  goToMenu(back: CloudReturn): void;
}

export interface CloudPlayOptions {
  session: GameSession & { cloud: NonNullable<GameSession['cloud']> };
  formatVersion: number;
  host: CloudPlayHost;
  /** Player settings + HUD layout of the game (cloud copy while playing). */
  settings?: (Pick<PlayerSettingsStore, 'load' | 'subscribe'> & CloudAttachable) | undefined;
}

/**
 * Cloud play of an account character: every save of the session (daily autosave, after sleep,
 * Zapisz i wyjdź) goes to the account; a 409 / 410 opens the session-conflict window (#166) over
 * the paused game, with NADPISZ SERWER as the third choice. The settings object (with the HUD
 * layout) keeps syncing to `PUT /v1/me/settings` while playing.
 */
export class CloudPlay {
  readonly saver: CloudSaver;
  private dialogOpen = false;
  private exitWaiter: ((left: boolean) => void) | undefined;

  constructor(private readonly o: CloudPlayOptions) {
    const s = o.session;
    this.saver = new CloudSaver({
      api: s.cloud.api,
      character: {
        id: s.character.id,
        worldSeed: s.character.worldSeed,
        worldgenVersion: s.cloud.worldgenVersion,
      },
      version: s.cloud.version,
      etag: s.cloud.etag,
      formatVersion: o.formatVersion,
      last: s.save
        ? { day: s.save.day, minuteOfDay: s.save.minuteOfDay ?? undefined, savedAt: s.save.savedAt }
        : undefined,
    });
    if (o.settings) {
      void startSettingsSync({ api: s.cloud.api, store: o.settings }).catch((e: unknown) =>
        console.warn('Ustawienia w chmurze: brak synchronizacji', e),
      );
    }
  }

  get lastSave(): SlotMeta | undefined {
    return this.saver.lastSave;
  }

  /** Autosave / after-sleep save of the worker. */
  async autosave(s: SaveInput): Promise<void> {
    const r = await this.saver.write(s);
    if (!r.ok) this.refused(r, 'autosave');
  }

  /**
   * Zapisz i wyjdź: resolves true once the save is on the server (or the player left through
   * the conflict window); throws a readable error when the upload failed (network, 429…).
   */
  async saveAndExit(s: SaveInput): Promise<void> {
    const r = await this.saver.write(s);
    if (r.ok) {
      this.o.host.goToMenu({ view: 'characters' });
      return;
    }
    if (r.reason === 'failed') throw new Error(failureText(r));
    const left = new Promise<boolean>((resolve) => (this.exitWaiter = resolve));
    this.refused(r, 'exit');
    if (await left) return;
    throw new Error('Zapis odrzucony przez serwer.');
  }

  /** Permadeath: the death snapshot to the account (tombstone). */
  async die(s: SaveInput): Promise<boolean> {
    return this.saver.die(s);
  }

  private refused(r: Exclude<CloudWriteResult, { ok: true }>, trigger: 'autosave' | 'exit'): void {
    if (r.reason === 'failed') {
      console.warn('Zapis w chmurze nie powiódł się', r.result);
      return;
    }
    if (this.dialogOpen) return;
    void this.showDialog(r, trigger);
  }

  private async showDialog(
    r: Extract<CloudWriteResult, { reason: 'conflict' | 'gone' }>,
    trigger: 'autosave' | 'exit',
  ): Promise<void> {
    this.dialogOpen = true;
    this.o.host.setPaused(true);
    const [{ mountOverlay }, { showSaveConflict }, { isFemale }] = await Promise.all([
      import('../menu/overlay-stage.js'),
      import('../menu/session-conflict.js'),
      import('../menu/cloud-characters-model.js'),
    ]);
    const overlay = mountOverlay(this.o.host.root, 'dzo--conflict');
    const c = this.o.session.character;
    const close = (): void => {
      document.removeEventListener('keydown', onKey, { capture: true });
      overlay.dispose();
      this.dialogOpen = false;
    };
    const leave = (back: Parameters<CloudPlayHost['goToMenu']>[0]): void => {
      close();
      this.exitWaiter?.(true);
      this.exitWaiter = undefined;
      this.o.host.goToMenu(back);
    };
    const dialog = showSaveConflict({
      host: overlay.stage,
      kind: r.reason,
      name: c.name,
      female: isFemale({
        name: c.name,
        appearance: c.appearance as unknown as Record<string, unknown>,
      }),
      trigger,
      local: r.local,
      server: r.reason === 'conflict' ? r.server : undefined,
      onLoadNewer: () => leave({ play: c.id }),
      onMenu: () => leave({ view: 'characters' }),
      onOverwrite: () => {
        close();
        void this.saver.overwrite().then((o) => {
          if (o.ok) {
            this.o.host.setPaused(false);
            if (this.exitWaiter) {
              this.exitWaiter(true);
              this.exitWaiter = undefined;
              this.o.host.goToMenu({ view: 'characters' });
            }
          } else if (o.reason === 'failed') {
            // Upload failed: the same choice again (the refused save is kept).
            console.warn('NADPISZ SERWER nie powiódł się', o.result);
            void this.showDialog(r, trigger);
          } else void this.showDialog(o, trigger);
        });
      },
    });
    function onKey(e: KeyboardEvent): void {
      if (dialog.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
  }
}

function failureText(r: Extract<CloudWriteResult, { reason: 'failed' }>): string {
  const f = r.result;
  if (f.ok) return '';
  if (f.reason === 'unauthorized') return 'Sesja wygasła. Zaloguj się ponownie w menu.';
  if (f.reason === 'rate-limited') return 'Za dużo zapisów. Spróbuj ponownie za chwilę.';
  if (f.reason === 'quota') return 'Brak miejsca na koncie. Usuń starą postać.';
  return 'Nie udało się wysłać zapisu na serwer. Spróbuj ponownie.';
}
