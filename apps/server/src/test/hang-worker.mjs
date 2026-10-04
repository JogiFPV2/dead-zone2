// Test worker that never answers (timeout and queue tests of the validation pool).
import { parentPort } from 'node:worker_threads';

parentPort?.on('message', () => {
  for (;;) {
    // Busy loop: only terminate() stops it.
  }
});
