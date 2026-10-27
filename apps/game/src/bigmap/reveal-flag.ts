/**
 * Test-only full map reveal (Paweł compares the map with Stalowa Wola). `?reveal=1` or
 * `?reveal=all` (or Ustawienia › Interfejs › „Odkryj całą mapę (test)”) sends the sim's debug
 * command `debugRevealMap` once after the world starts; the fog bits live in the sim.
 */
export function revealFlag(search: string): boolean {
  const v = new URLSearchParams(search).get('reveal');
  return v === '1' || v === 'all';
}

/**
 * Far-zoom overview (whole-map terrain atlas, place names, edge) of the big map: `?bigmap16=1`,
 * or on with the test reveal, which is pointless without it (the classic map paints only the
 * chunks around the player). Read once at boot.
 */
export function bigMapOverview(
  bigmap16: boolean | undefined,
  search: string,
  revealSetting: boolean,
): boolean {
  return !!bigmap16 || revealFlag(search) || revealSetting;
}

/** Sends the reveal command at most once, as soon as it is wanted and the sim is ready. */
export class MapRevealer {
  private sent = false;
  private ready = false;

  constructor(
    private readonly send: () => void,
    private wanted: boolean,
  ) {}

  /** The sim has sent its first view (world started). */
  worldReady(): void {
    this.ready = true;
    this.flush();
  }

  /** The settings toggle changed (turning it off does not re-fog: the bits are saved). */
  setWanted(on: boolean): void {
    this.wanted = this.wanted || on;
    this.flush();
  }

  get done(): boolean {
    return this.sent;
  }

  private flush(): void {
    if (this.sent || !this.ready || !this.wanted) return;
    this.sent = true;
    this.send();
  }
}
