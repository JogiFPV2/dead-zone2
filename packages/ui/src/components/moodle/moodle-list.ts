import { defaultDoc, el, type Doc, type Mounted } from '../../dom/h.js';
import { createMoodle, type MoodleProps } from './moodle.js';
import { createOverflowChip } from './overflow-chip.js';
import { planOverflow, sortMoodles, type MoodleVM } from './model.js';

export interface MoodleListOptions {
  /** Max rows before the rest folds into "+N" (spec: 2 rows at 380 px). Needs live layout. */
  maxRows?: number;
  /** Hard cap on visible chips (incl. "+N"); useful without layout (tests, SSR). */
  maxVisible?: number;
}

/**
 * The moodle row under the objective card. Keyed by `MoodleVM.id`; level 0 removes the element.
 * Ordering and overflow follow spec §3.2.
 */
export function createMoodleList(
  moodles: readonly MoodleVM[],
  options: MoodleListOptions = {},
  doc: Doc = defaultDoc(),
): Mounted<readonly MoodleVM[]> {
  const root = el(doc, 'div', 'dz-moodle-list');
  const chips = new Map<string, Mounted<MoodleProps>>();
  const more = createOverflowChip(0, doc);
  const maxRows = options.maxRows ?? 2;
  let first = true;

  const render = (list: readonly MoodleVM[], maxVisible: number): void => {
    const { visible, overflow } = planOverflow(sortMoodles(list), maxVisible);
    const keep = new Set(visible.map((m) => m.id));
    for (const [id, chip] of chips) {
      if (!keep.has(id)) {
        chip.destroy();
        chips.delete(id);
      }
    }
    for (const m of visible) {
      const props: MoodleProps = { label: m.label, polarity: m.polarity, level: m.level };
      if (m.description !== undefined) props.description = m.description;
      let chip = chips.get(m.id);
      if (chip) chip.update(props);
      else {
        chip = createMoodle(first ? { ...props, noEnter: true } : props, doc);
        chip.el.dataset.id = m.id;
        chips.set(m.id, chip);
      }
      root.appendChild(chip.el); // re-append keeps DOM order == sorted order
    }
    if (overflow > 0) {
      more.update(overflow);
      root.appendChild(more.el);
    } else more.el.remove();
  };

  const rowCount = (): number =>
    new Set([...root.children].map((c) => (c as HTMLElement).offsetTop)).size;

  const update = (list: readonly MoodleVM[]): void => {
    const cap = options.maxVisible ?? Number.POSITIVE_INFINITY;
    render(list, cap);
    // Fit to maxRows when laid out (offsetHeight is 0 when detached / no layout engine).
    if (root.isConnected && root.offsetHeight > 0) {
      let n = Math.min(cap, root.children.length);
      while (n > 1 && rowCount() > maxRows) render(list, --n);
    }
    first = false;
  };
  update(moodles);
  return {
    el: root,
    update,
    destroy: () => {
      root.remove();
      chips.clear();
    },
  };
}
