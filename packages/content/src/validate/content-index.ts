import { CONTENT_TYPES, type ContentType } from '../schemas/content-type.js';
import type { ContentOf } from '../schemas/registry.js';
import type { SourceRef } from './source.js';

export interface IndexedDefinition<T extends ContentType = ContentType> {
  type: T;
  id: string;
  data: ContentOf<T>;
  source: SourceRef;
}

/** Zbiór wszystkich definicji po wczytaniu paczek i nadpisań, per typ i id. */
export class ContentIndex {
  private readonly maps = new Map<ContentType, Map<string, IndexedDefinition>>(
    CONTENT_TYPES.map((t) => [t, new Map()]),
  );

  map<T extends ContentType>(type: T): Map<string, IndexedDefinition<T>> {
    return this.maps.get(type) as Map<string, IndexedDefinition<T>>;
  }

  get<T extends ContentType>(type: T, id: string): IndexedDefinition<T> | undefined {
    return this.map(type).get(id);
  }

  has(type: ContentType, id: string): boolean {
    return this.map(type).has(id);
  }

  set(def: IndexedDefinition): void {
    this.map(def.type).set(def.id, def);
  }

  delete(type: ContentType, id: string): void {
    this.map(type).delete(id);
  }

  *all(): Iterable<IndexedDefinition> {
    for (const m of this.maps.values()) yield* m.values();
  }

  /** Zwykłe obiekty per typ — gotowe do użycia przez symulację. */
  toRecord(): { [T in ContentType]: Record<string, ContentOf<T>> } {
    const out = {} as { [T in ContentType]: Record<string, ContentOf<T>> };
    for (const t of CONTENT_TYPES) {
      (out as Record<string, Record<string, unknown>>)[t] = Object.fromEntries(
        [...this.map(t).values()].map((d) => [d.id, d.data]),
      );
    }
    return out;
  }
}
