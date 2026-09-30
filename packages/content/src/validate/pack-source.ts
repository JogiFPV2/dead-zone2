/**
 * Paczka w pamięci: lista plików ze ścieżką względem korzenia paczki (separator `/`).
 * Plik ma tekst JSON (z dysku, z sieci) albo już sparsowany obiekt (np. import JSON w bundlerze).
 * Dzięki temu rdzeń walidatora nie zależy od `node:fs` i działa w przeglądarce oraz na serwerze.
 */
export type PackFile = { path: string; text: string } | { path: string; json: unknown };

export interface PackSource {
  /** Etykieta paczki w błędach (np. katalog). */
  dir: string;
  files: PackFile[];
}
