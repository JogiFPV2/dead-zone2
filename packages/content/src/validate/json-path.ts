export type PathSegment = string | number;

/** `["entries", 0, "item"]` → `$.entries[0].item`. */
export function formatJsonPath(segments: readonly PropertyKey[]): string {
  let out = '$';
  for (const s of segments) {
    if (typeof s === 'number') out += `[${s}]`;
    else if (typeof s === 'string' && /^[A-Za-z_$][\w$]*$/.test(s)) out += `.${s}`;
    else out += `[${JSON.stringify(String(s))}]`;
  }
  return out;
}
