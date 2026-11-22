// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const appPackages = ['@deadzone/web', '@deadzone/game', '@deadzone/server'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['**/*.{js,mjs}'], extends: [tseslint.configs.disableTypeChecked] },
  { files: ['apps/web/**', 'apps/game/**'], languageOptions: { globals: globals.browser } },
  { files: ['apps/server/**', 'scripts/**', '**/*.config.{js,ts}'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/**/*.tsx'], extends: [reactHooks.configs.flat['recommended-latest']] },
  // Package boundaries: libraries never import apps.
  {
    files: ['packages/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: appPackages, patterns: ['**/apps/**'] }],
    },
  },
  // packages/sim must stay pure: no render, UI, DOM or Node APIs (runs in Worker and on server).
  {
    files: ['packages/sim/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: appPackages,
          patterns: [
            { group: ['three', 'three/*'], message: 'sim nie może zależeć od renderu.' },
            { group: ['react', 'react-dom', 'react/*'], message: 'sim nie może zależeć od UI.' },
            {
              group: ['node:*', 'fastify'],
              message: 'sim musi działać w przeglądarce i na serwerze.',
            },
            { group: ['**/apps/**'], message: 'Pakiety nie importują aplikacji.' },
          ],
        },
      ],
    },
  },
  // Determinism (docs/sim-architecture.md 1.2): no wall clock, no Math.random, no
  // engine-dependent transcendental math, no host globals in sim logic.
  {
    files: ['packages/sim/src/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['random', 'sin', 'cos', 'tan', 'atan', 'atan2', 'exp', 'log', 'pow', 'hypot'].map(
          (property) => ({
            object: 'Math',
            property,
            message: 'Niedeterministyczne w sim: użyj core/rng lub core/dmath.',
          }),
        ),
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'Date',
          'performance',
          'setTimeout',
          'setInterval',
          'queueMicrotask',
          'requestAnimationFrame',
          'self',
          'window',
          'document',
          'globalThis',
        ].map((name) => ({
          name,
          message: 'Czas i API hosta tylko w src/host/worker-entry.ts; w sim czas = numer ticku.',
        })),
      ],
    },
  },
  // The worker entry is the single place that binds the host (globalThis, timers, clock).
  {
    files: ['packages/sim/src/host/worker-entry.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  prettier,
);
