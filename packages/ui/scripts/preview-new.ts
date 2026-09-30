/** Preview section with the components added in PR 2 (Clock, Toast, hints, ObjectiveCard). */
import { composite, contrastRatio } from '../src/tokens/contrast.js';
import { tokens } from '../src/tokens/tokens.generated.js';
import type { Doc } from '../src/dom/h.js';
import {
  DEFAULT_HINTS,
  createClock,
  createKeyHints,
  createObjectiveCard,
  createToast,
  type HudMood,
  type ObjectiveVM,
  type ToastVM,
} from '../src/index.js';

export interface PreviewKit {
  h: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
  ) => HTMLElementTagNameMap[K];
  cell: (node: HTMLElement, caption: string) => HTMLElement;
}

const c = tokens.color;
/** Lowest text contrast of a component over a scene: [fg, surface…] pairs. */
function minRatio(scene: string, pairs: [string, ...string[]][]): string {
  const ratios = pairs.map(([fg, ...on]) => {
    const back = on.slice(0, -1).reduce((b, layer) => {
      const { r, g, b: bl } = composite(layer, b);
      return `rgb(${r}, ${g}, ${bl})`;
    }, scene);
    return contrastRatio(fg, on.at(-1) ?? scene, back);
  });
  return `min ${Math.min(...ratios).toFixed(2)}:1`;
}

const rescue: ObjectiveVM = {
  id: 'reach-villa',
  title: 'Dotrzyj do willi na wzgórzu',
  progress: 0.4,
  state: 'active',
  step: 1,
  steps: 3,
};
const toasts: ToastVM[] = [
  { id: 'a', kind: 'damage', value: '−12 HP', text: 'Ugryzienie: lewe przedramię', createdAt: 0 },
  { id: 'b', kind: 'gain', value: '+3', text: 'Brodawka', createdAt: 0, count: 2 },
  { id: 'c', kind: 'warning', text: 'Ból 2', createdAt: 0 },
  { id: 'd', kind: 'info', text: 'Dzień 4', createdAt: 0 },
];

/** New components in every state, over the scene colour of `mood`. */
export function buildNewComponents(
  doc: Doc,
  mood: HudMood,
  scene: string,
  kit: PreviewKit,
): HTMLElement {
  const { h, cell } = kit;
  const band = h('div', 'pv-band');
  const row = () => {
    const r = h('div', 'pv-row');
    band.append(r);
    return r;
  };
  const ratio = (pairs: [string, ...string[]][]) => minRatio(scene, pairs);

  // ObjectiveCard: active / updated / completed / 2-line title (ellipsis).
  const cards = row();
  const updated = createObjectiveCard(
    {
      ...rescue,
      id: 'free',
      title: 'Uwolnij lekarza z piwnicy',
      step: 2,
      progress: 0.1,
      state: 'updated',
    },
    {},
    doc,
  );
  const objRatio = ratio([
    [c.accent.base, c.bg.hud],
    [c.text.primary, c.bg.hud],
    [c.text.muted, c.bg.hud],
    [c.success.text, c.bg.hud],
  ]);
  cards.append(
    cell(
      createObjectiveCard(rescue, {}, doc).el,
      `ObjectiveCard · active · krok 1/3 · ${objRatio}`,
    ),
    cell(updated.el, 'updated · ramka accent 600 ms'),
    cell(
      createObjectiveCard(
        {
          ...rescue,
          id: 'x',
          title: 'Doprowadź lekarza do strefy ewakuacji',
          step: 3,
          progress: 1,
          state: 'completed',
        },
        {},
        doc,
      ).el,
      'completed · znika po 3 s',
    ),
    cell(
      createObjectiveCard(
        {
          id: 'long',
          title:
            'Doprowadź ocalałego lekarza z willi na wzgórzu do strefy ewakuacji przy stacji benzynowej, omijając hordę',
          progress: 0.75,
          state: 'active',
        },
        {},
        doc,
      ).el,
      'tytuł: maks. 2 linie + wielokropek · none = ukryta',
    ),
  );

  // Clock, toasts.
  const mid = row();
  const clocks = h('div', 'pv-row');
  clocks.style.gap = '12px';
  for (const m of [7 * 60, 19 * 60 + 30, 21 * 60 + 47])
    clocks.append(createClock({ day: 12, minuteOfDay: m }, doc).el);
  mid.append(
    cell(
      clocks,
      `Clock · 07:00 / 19:30 / 21:47 · ${ratio([
        [c.text.muted, c.bg.hud],
        [c.text.primary, c.bg.hud],
      ])}`,
    ),
  );
  const stack = h('div', 'dz-toasts');
  for (const t of toasts) stack.append(createToast(t, doc).el);
  mid.append(
    cell(
      stack,
      `Toast · damage / gain ×2 / warning / info · ${ratio([
        [c.text.primary, c.bg.hud],
        [c.danger.text, c.bg.hud],
        [c.success.text, c.bg.hud],
        [c.warning.text, c.bg.hud],
      ])}`,
    ),
  );

  // Key hints.
  const hints = row();
  hints.append(
    cell(
      createKeyHints({ items: DEFAULT_HINTS, visible: true }, doc).el,
      `Wiersz skrótów · pierwsze 10 min, F1 · ${ratio([[c.text.muted, c.bg.hud]])}`,
    ),
  );
  band.dataset.mood = mood;
  return band;
}
