import type { PauseMenu, PauseMenuOptions } from './pause-menu.js';
import { createPauseMenu } from './pause-menu.js';
import type { PauseInfo, WorldSaveMeta } from './pause-model.js';

/** What the pause needs from the game (kept narrow so co-op can plug in its own). */
export interface PauseHost {
  /** Stops / restarts the sim (ticks, game time). Only called when `pausesSim`. */
  setSimPaused(paused: boolean): void;
  /** Blocks game input (InputMap) while the menu is open. */
  setInputSuspended(suspended: boolean): void;
  info(): PauseInfo;
  lastSave(): WorldSaveMeta | undefined;
  /** Save the single world save, then leave to the main menu. */
  saveAndExit(): Promise<void>;
}

export type PauseControllerOptions = Omit<
  PauseMenuOptions,
  'info' | 'lastSave' | 'onResume' | 'onSaveExit'
> & { readonly host: PauseHost; readonly document?: Document };

/**
 * Opens / closes the pause menu. Single-player (`pausesSim`) stops the sim while open; a future
 * co-op session passes `pausesSim: false` and only gets the menu. While open, every keydown is
 * routed to the menu and kept from the game.
 */
export class PauseController {
  private menu: PauseMenu | undefined;
  private readonly doc: Document;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.menu) return;
    if (this.menu.onKey(e)) e.preventDefault();
    // Nothing reaches the game underneath (inventory keys, hints, quick slots…).
    e.stopPropagation();
  };

  constructor(private readonly o: PauseControllerOptions) {
    this.doc = o.document ?? document;
  }

  get open(): boolean {
    return this.menu !== undefined;
  }

  /** Whether the sim is stopped by this menu right now. */
  get simPaused(): boolean {
    return this.open && this.o.pausesSim;
  }

  openMenu(): void {
    if (this.menu) return;
    const { host } = this.o;
    host.setInputSuspended(true);
    if (this.o.pausesSim) host.setSimPaused(true);
    this.menu = createPauseMenu({
      ...this.o,
      info: host.info(),
      lastSave: host.lastSave(),
      onResume: () => this.close(),
      onSaveExit: () => host.saveAndExit(),
    });
    this.doc.addEventListener('keydown', this.onKey, true);
  }

  close(): void {
    if (!this.menu) return;
    this.doc.removeEventListener('keydown', this.onKey, true);
    this.menu.dispose();
    this.menu = undefined;
    if (this.o.pausesSim) this.o.host.setSimPaused(false);
    this.o.host.setInputSuspended(false);
  }

  dispose(): void {
    this.close();
  }
}
