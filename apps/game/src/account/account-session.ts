import type { LocalPlayerSettingsStore } from '../settings/player-settings-store.js';
import type { AccountApi, AccountUser } from './account-api.js';
import { startSettingsSync, type SettingsSync } from './settings-sync.js';

/** „Graj offline” chosen on the login screen: no login screen at the next start. */
export const OFFLINE_CHOICE_KEY = 'deadzone.account.offline';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AccountSessionOptions {
  api: AccountApi;
  /** Whole settings object (local + cloud copy after sign-in). */
  settings?: LocalPlayerSettingsStore | undefined;
  storage?: StorageLike | undefined;
}

/**
 * Who is playing: logged-in account (online screens, cloud settings) or offline (local saves).
 * Shared by the main menu, Postacie and Ustawienia › Konto; listeners re-render on changes.
 */
export class AccountSession {
  readonly api: AccountApi;
  private current: AccountUser | undefined;
  private offline: boolean;
  private sync: SettingsSync | undefined;
  private readonly listeners = new Set<() => void>();
  /** Characters with a save or load in flight (badge `SYNCHRONIZUJĘ…`, Graj → `CZEKAJ…`). */
  readonly syncing = new Set<string>();
  /** One-shot menu toast (`Konto zostało usunięte.`, `Sesja wygasła…`). */
  pendingToast: string | undefined;
  /** E-mail to prefill on the login screen (session expired). */
  lastEmail: string | undefined;

  constructor(private readonly o: AccountSessionOptions) {
    this.api = o.api;
    let chosen: boolean;
    try {
      chosen = o.storage?.getItem(OFFLINE_CHOICE_KEY) === '1';
    } catch {
      chosen = false;
    }
    this.offline = chosen;
  }

  /** Online screens exist at all (mock or configured server). */
  get online(): boolean {
    return this.api.online;
  }
  get user(): AccountUser | undefined {
    return this.current;
  }
  /** Postacie / Kontynuuj use the account (otherwise the local IndexedDB slots). */
  get cloud(): boolean {
    return this.online && !!this.current;
  }
  /** First start without a session and without „Graj offline”: show the login screen. */
  get needsLogin(): boolean {
    return this.online && !this.current && !this.offline;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Restores the session (stored token / OAuth redirect). */
  async restore(): Promise<void> {
    if (!this.online) return;
    const u = await this.api.session();
    if (u) await this.signedIn(u);
  }

  async signedIn(user: AccountUser): Promise<void> {
    this.current = user;
    this.lastEmail = user.email;
    this.setOffline(false);
    for (const id of this.api.demoSync?.ids ?? []) {
      this.syncing.add(id);
      setTimeout(() => this.setSyncing(id, false), this.api.demoSync?.ms ?? 0);
    }
    this.emit();
    if (this.o.settings && !this.sync) {
      try {
        this.sync = await startSettingsSync({ api: this.api, store: this.o.settings });
      } catch (e) {
        console.warn('Ustawienia w chmurze: brak synchronizacji', e);
      }
    }
  }

  chooseOffline(): void {
    this.setOffline(true);
    this.emit();
  }

  async signOut(): Promise<void> {
    await this.sync?.flush().catch(() => undefined);
    this.sync?.stop();
    this.sync = undefined;
    await this.api.signOut();
    this.current = undefined;
    this.syncing.clear();
    this.emit();
  }

  /** 401 on a data call: local logout and back to the login screen with the e-mail filled. */
  expired(): void {
    this.lastEmail = this.current?.email ?? this.lastEmail;
    this.sync?.stop();
    this.sync = undefined;
    this.current = undefined;
    this.pendingToast = 'Sesja wygasła. Zaloguj się ponownie.';
    this.emit();
  }

  /** After `DELETE /v1/me`: logged out, menu toast. */
  deleted(): void {
    this.sync?.stop();
    this.sync = undefined;
    this.current = undefined;
    this.lastEmail = undefined;
    this.pendingToast = 'Konto zostało usunięte.';
    this.emit();
  }

  setSyncing(id: string, on: boolean): void {
    if (on === this.syncing.has(id)) return;
    if (on) this.syncing.add(id);
    else this.syncing.delete(id);
    this.emit();
  }

  private setOffline(v: boolean): void {
    this.offline = v;
    try {
      if (v) this.o.storage?.setItem(OFFLINE_CHOICE_KEY, '1');
      else this.o.storage?.removeItem(OFFLINE_CHOICE_KEY);
    } catch {
      // Storage disabled: the choice lasts for this page only.
    }
  }
}
