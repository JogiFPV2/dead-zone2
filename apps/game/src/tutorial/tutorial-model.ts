import type { Bindings } from '../input/bindings.js';
import { actionKey, moveKeysLabel } from '../hud/key-label.js';

/** Screens the tutorial watches being opened (input actions). */
export type TutorialScreen = 'inventory' | 'crafting' | 'map';

/** What the tutorial looks at each frame (built from GameState in `game.ts`). */
export interface TutorialInput {
  /** Seconds since the game started. */
  now: number;
  /** Metres walked so far. */
  walked: number;
  /** Items in the player's inventory. */
  items: number;
  /** A container or ground pile within reach. */
  nearContainer: boolean;
  hunger: number;
  thirst: number;
  /** Sim threat 0–100. */
  threat: number;
  night: boolean;
  /** Firearm in the right hand. */
  firearm: boolean;
  wounded: boolean;
  opened: ReadonlySet<TutorialScreen>;
  alive: boolean;
  sleeping: boolean;
}

export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  text(b: Bindings): string;
  /** The hint becomes relevant (shown when no other hint is up). */
  when(i: TutorialInput): boolean;
  /** The player did it: the hint goes away (after `MIN_SHOW_SEC`). */
  done(i: TutorialInput, shownAt: TutorialInput): boolean;
}

/** A hint stays at least this long, and at most this long when the player ignores it. */
export const MIN_SHOW_SEC = 4;
export const MAX_SHOW_SEC = 30;
/** Pause between two hints. */
export const GAP_SEC = 3;

const k = actionKey;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'move',
    title: 'Ruch',
    text: (b) =>
      `Chodzisz klawiszami ${moveKeysLabel(b)}, kierunek wskazuje mysz. ${k(b, 'sprint')} to bieg, ${k(b, 'crouch')} włącza skradanie. ${k(b, 'rotateCameraLeft')} i ${k(b, 'rotateCameraRight')} obracają kamerę.`,
    when: () => true,
    done: (i, at) => i.walked - at.walked > 8,
  },
  {
    id: 'search',
    title: 'Przeszukiwanie',
    text: (b) =>
      `Szafki, lodówki i regały mają zapasy. Podejdź do mebla, naciśnij ${k(b, 'interact')}, żeby otworzyć, albo przytrzymaj ${k(b, 'interact')}, żeby przeszukać.`,
    when: (i) => i.nearContainer,
    done: (i, at) => i.items > at.items,
  },
  {
    id: 'inventory',
    title: 'Ekwipunek',
    text: (b) =>
      `${k(b, 'inventory')} otwiera ekwipunek. Broń i narzędzia weźmiesz do ręki z ekwipunku albo klawiszami 1–5 z paska na dole.`,
    when: (i) => i.items > 0,
    done: (i) => i.opened.has('inventory'),
  },
  {
    id: 'zombies',
    title: 'Zombie',
    text: (b) =>
      `Zombie reagują na hałas i na to, co widzą. Skradaj się (${k(b, 'crouch')}) i trzymaj się cienia. Oko pod paskiem zdrowia pokazuje, jak dobrze cię widać.`,
    when: (i) => i.threat >= 15,
    done: (i, at) => i.now - at.now > 14,
  },
  {
    id: 'firearm',
    title: 'Broń palna',
    text: (b) =>
      `${k(b, 'secondaryAction')} to celowanie, ${k(b, 'primaryAction')} strzał, ${k(b, 'reload')} przeładowanie. Strzał słychać daleko i ściąga zombie z okolicy.`,
    when: (i) => i.firearm,
    done: (i, at) => i.now - at.now > 12,
  },
  {
    id: 'hunger',
    title: 'Głód i pragnienie',
    text: () =>
      'Robisz się głodny lub spragniony. Otwórz ekwipunek i kliknij jedzenie albo picie prawym przyciskiem myszy, żeby je zjeść lub wypić.',
    when: (i) => i.hunger >= 35 || i.thirst >= 35,
    done: (i, at) => i.hunger < at.hunger - 5 || i.thirst < at.thirst - 5,
  },
  {
    id: 'wounds',
    title: 'Rany',
    text: (b) =>
      `Jesteś ranny. Ranę trzeba opatrzyć bandażem, inaczej krwawi i może się zakazić. Bandaż zrobisz w craftingu (${k(b, 'crafting')}).`,
    when: (i) => i.wounded,
    done: (i) => !i.wounded,
  },
  {
    id: 'crafting',
    title: 'Crafting',
    text: (b) =>
      `${k(b, 'crafting')} otwiera crafting: bandaże, broń, barykady na okna. Część przepisów wymaga narzędzi albo umiejętności.`,
    when: (i) => i.now > 240,
    done: (i) => i.opened.has('crafting'),
  },
  {
    id: 'night',
    title: 'Noc',
    text: (b) =>
      `Zapada noc. Widzisz mniej, zombie też. Latarka pomaga, ale zdradza, gdzie jesteś. ${k(b, 'sleep')} to sen, najlepiej w zamkniętym budynku.`,
    when: (i) => i.night,
    done: (i, at) => i.now - at.now > 14,
  },
  {
    id: 'map',
    title: 'Mapa',
    text: (b) =>
      `${k(b, 'map')} otwiera mapę Stalowej Woli z odkrytymi miejscami. Licznik dni u góry to Twój wynik: przeżyj jak najdłużej.`,
    when: (i) => i.now > 420,
    done: (i) => i.opened.has('map'),
  },
];

export interface TutorialHint {
  id: string;
  title: string;
  text: string;
}

/**
 * One hint at a time, in step order: the first step not yet done whose `when` holds. A hint ends
 * when the player does what it says (after MIN_SHOW_SEC) or after MAX_SHOW_SEC; ended steps are
 * listed in `doneIds` (saved by the caller, so they are not repeated in later games).
 */
export class Tutorial {
  private readonly done: Set<string>;
  private current: { step: TutorialStep; at: TutorialInput } | undefined;
  private endedAt = -Infinity;

  constructor(
    doneIds: Iterable<string> = [],
    private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS,
  ) {
    this.done = new Set(doneIds);
  }

  get doneIds(): string[] {
    return [...this.done];
  }

  get finished(): boolean {
    return this.steps.every((s) => this.done.has(s.id));
  }

  /** Closes the current hint (× on the card). */
  dismiss(now: number): void {
    if (!this.current) return;
    this.done.add(this.current.step.id);
    this.current = undefined;
    this.endedAt = now;
  }

  update(i: TutorialInput, b: Bindings): TutorialHint | undefined {
    if (!i.alive || i.sleeping) return undefined;
    const c = this.current;
    if (c) {
      const age = i.now - c.at.now;
      if ((age >= MIN_SHOW_SEC && c.step.done(i, c.at)) || age >= MAX_SHOW_SEC) {
        this.done.add(c.step.id);
        this.current = undefined;
        this.endedAt = i.now;
      } else return { id: c.step.id, title: c.step.title, text: c.step.text(b) };
    }
    if (i.now - this.endedAt < GAP_SEC) return undefined;
    const next = this.steps.find((s) => !this.done.has(s.id) && s.when(i));
    if (!next) return undefined;
    this.current = { step: next, at: { ...i, opened: new Set(i.opened) } };
    return { id: next.id, title: next.title, text: next.text(b) };
  }
}
