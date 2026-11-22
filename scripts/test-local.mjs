// Lokalne testy (Windows/Linux/macOS): Paweł odpala je u siebie przed każdym PR-em.
// Paczki idą po kolei (--concurrency=1), żeby równoległe Vitesty nie zagłodziły
// procesora, a CI=1 włącza dłuższe limity czasu tam, gdzie konfiguracja je zna.
// Testy wydajności sima pomijamy (SKIP_PERF=1); pełny zestaw z nimi: pnpm test.
import { spawnSync } from 'node:child_process';

const env = { ...process.env, CI: process.env.CI ?? '1', SKIP_PERF: process.env.SKIP_PERF ?? '1' };
const args = [
  'exec',
  'turbo',
  'run',
  'test',
  '--concurrency=1',
  '--continue',
  ...process.argv.slice(2),
];
const r = spawnSync('pnpm', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
