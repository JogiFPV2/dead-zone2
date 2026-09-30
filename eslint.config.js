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
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  { files: ['apps/web/**', 'apps/game/**'], languageOptions: { globals: globals.browser } },
  { files: ['apps/server/**', '**/*.config.{js,ts}'], languageOptions: { globals: globals.node } },
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
  prettier,
);
