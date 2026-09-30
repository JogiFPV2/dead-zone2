import type { ContentType } from '../../schemas/content-type.js';
import type { PathSegment } from '../json-path.js';

/** Referencja wyciągnięta z definicji: typ celu, id celu i ścieżka pola. */
export interface CollectedRef {
  type: ContentType;
  id: string;
  path: PathSegment[];
}

/** Referencja do tagu przedmiotów (składniki/narzędzia receptur). */
export interface CollectedTagRef {
  tag: string;
  path: PathSegment[];
}

export class RefList {
  readonly refs: CollectedRef[] = [];
  readonly tags: CollectedTagRef[] = [];

  add(type: ContentType, id: string | undefined, ...path: PathSegment[]): void {
    if (id !== undefined) this.refs.push({ type, id, path });
  }

  many(type: ContentType, ids: readonly string[] | undefined, ...path: PathSegment[]): void {
    ids?.forEach((id, i) => this.add(type, id, ...path, i));
  }

  /** Dopasowanie `{item}` albo `{tag}` (składnik, narzędzie). */
  matcher(m: { item: string } | { tag: string }, ...path: PathSegment[]): void {
    if ('item' in m) this.add('item', m.item, ...path, 'item');
    else this.tags.push({ tag: m.tag, path: [...path, 'tag'] });
  }
}
