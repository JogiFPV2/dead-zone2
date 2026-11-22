import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pierwszy test w pliku buduje bundle całej paczki base (`baseBundle()`): na Windowsie, przy
    // równoległym `pnpm test` całego monorepo, trwa to 5–7 s, więc domyślne 5 s było za mało.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
