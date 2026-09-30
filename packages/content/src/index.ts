// Główny punkt wejścia: czysty TypeScript, bez API Node — bezpieczny dla przeglądarki i `packages/sim`.
// Wczytywanie paczek z dysku i CLI są w `@deadzone/content/node`.
export * from './schemas/index.js';
export * from './validate/index.js';
export * from './bundle/index.js';
