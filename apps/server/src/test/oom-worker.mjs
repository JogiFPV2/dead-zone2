// Test worker for the pool's memory cap. An oversized save (more bytes than `opts.maxStateBytes`)
// fills the heap in large on-heap chunks until V8 kills the worker (ERR_WORKER_OUT_OF_MEMORY → 413).
// Any other save gets a cheap success reply (envelope header, size, SHA-256) so the test can check
// that the pool replaced the dead worker and keeps answering; real validation in a worker is
// covered by the other worker-pool tests.
//
// Large chunks, not millions of tiny objects: near the heap cap V8 runs a full GC per allocation,
// and with tiny objects on a loaded box that could crawl past the pool's time budget (→ 422).
import { createHash } from 'node:crypto';
import { parentPort } from 'node:worker_threads';

/** One chunk ≈ 1 MiB of V8 heap (a packed double array: 8 bytes per element). */
const CHUNK_ELEMENTS = 128 * 1024;
const PREFIX_BYTES = 12;

parentPort?.on('message', ({ id, bytes, opts }) => {
  if (bytes.length > opts.maxStateBytes) {
    const keep = [];
    for (;;) keep.push(new Array(CHUNK_ELEMENTS).fill(keep.length + 0.5));
  }
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  const headerEnd = PREFIX_BYTES + buf.readUInt32LE(8);
  const header = JSON.parse(buf.subarray(PREFIX_BYTES, headerEnd).toString('utf8'));
  parentPort.postMessage({
    id,
    ok: true,
    result: {
      header,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
});
