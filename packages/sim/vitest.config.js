import { configDefaults, defineConfig } from 'vitest/config';

// SKIP_PERF=1 (CI na pull requestach) pomija testy wydajności sima (*.perf.test.ts, *-perf.test.ts).
// Na push do main i przy ręcznym uruchomieniu CI wykonują się normalnie.
const skipPerf = Boolean(process.env.SKIP_PERF);

export default defineConfig({
  test: {
    // CI chodzi na współdzielonym self-hosted runnerze (box) - pod obciążeniem domyślne 5 s bywa za mało.
    testTimeout: process.env.CI ? 30_000 : 5_000,
    exclude: [
      ...configDefaults.exclude,
      ...(skipPerf ? ['**/*.perf.test.ts', '**/*-perf.test.ts'] : []),
    ],
  },
});
