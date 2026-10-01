/** Calls `fn` with the latest arguments once no call came for `ms` (e.g. persist wheel zoom). */
export function debounced<A extends unknown[]>(
  ms: number,
  fn: (...args: A) => void,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
}
