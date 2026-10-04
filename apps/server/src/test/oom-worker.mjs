// Test worker that allocates until it hits its heap cap (memory limit test of the pool).
import { parentPort } from 'node:worker_threads';

parentPort?.on('message', () => {
  const keep = [];
  for (;;) keep.push({ n: keep.length, s: `x${keep.length}` });
});
