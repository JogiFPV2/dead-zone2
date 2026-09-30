/** Minimal DOM helpers. Text goes through `textContent` only (no innerHTML), per spec §5. */

export type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

/** Default document; components take an explicit `doc` for tests and SSR-style rendering. */
export const defaultDoc = (): Doc => globalThis.document;

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Doc,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Sets or removes a `data-*` attribute (undefined/false removes it). */
export function setData(node: HTMLElement, key: string, value: string | boolean | undefined): void {
  if (value === undefined || value === false) delete node.dataset[key];
  else node.dataset[key] = value === true ? '' : value;
}

/** Common handle returned by every component factory. */
export interface Mounted<P> {
  readonly el: HTMLElement;
  update(props: P): void;
  destroy(): void;
}
