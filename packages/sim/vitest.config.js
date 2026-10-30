import { configDefaults, defineConfig } from 'vitest/config';

// SKIP_PERF=1 (CI na pull requestach) pomija testy wydajności sima (*.perf.test.ts, *-perf.test.ts).
// Na push do main i przy ręcznym uruchomieniu CI wykonują się normalnie.
const skipPerf = Boolean(process.env.SKIP_PERF);

export default defineConfig({
  test: {
    // CI chodzi na współdzielonym self-hosted runnerze (box) - pod obciążeniem domyślne 5 s bywa za mało.
    testTimeout: process.env.CI ? 30_000 : 5_000,
    // CI: wątki zamiast forków. Pod obciążeniem boxa fork startował/kończył się dłużej niż stałe 60 s
    // vitest-pool-runner („Timeout waiting for worker to respond” przy brain.test / sleep-until.test).
    // Sim to czysty TS bez DOM i process.chdir, więc worker_threads wystarczają; wątek startuje
    // szybciej i bierze mniej pamięci. Izolacja plików bez zmian (osobny kontekst na plik).
    ...(process.env.CI ? { pool: 'threads' } : {}),
    hookTimeout: process.env.CI ? 60_000 : 10_000,
    teardownTimeout: process.env.CI ? 60_000 : 10_000,
    exclude: [
      ...configDefaults.exclude,
      ...(skipPerf ? ['**/*.perf.test.ts', '**/*-perf.test.ts'] : []),
    ],
  },
});
