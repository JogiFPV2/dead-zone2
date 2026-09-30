/** FLIP helper: animates siblings from their old position after a DOM change (spec §3.4). */

/** Records child tops, runs `mutate`, then offsets moved children and lets CSS transition them. */
export function flip(container: HTMLElement, mutate: () => void): void {
  const before = new Map<Element, number>();
  for (const c of container.children) before.set(c, c.getBoundingClientRect().top);
  mutate();
  for (const c of container.children) {
    const top = before.get(c);
    if (top === undefined || !(c instanceof HTMLElement)) continue;
    const dy = top - c.getBoundingClientRect().top;
    if (dy === 0) continue;
    c.style.transition = 'none';
    c.style.transform = `translateY(${dy}px)`;
    void c.offsetHeight; // commit the offset before transitioning back
    c.style.transition = '';
    c.style.transform = '';
  }
}
