/** `worker_threads` entry: validates one DZSV envelope per message (docs/backend.md §5.2.3). */
import { parentPort } from 'node:worker_threads';
import { HttpError } from '../errors.js';
import { validateEnvelope, type ValidateOptions } from './validate.js';
import type { WorkerReply, WorkerRequest } from './worker-pool.js';

if (!parentPort) throw new Error('validate-worker must run in a worker thread');
const port = parentPort;

port.on('message', (msg: WorkerRequest) => {
  let reply: WorkerReply;
  try {
    const opts: ValidateOptions = msg.opts;
    reply = { id: msg.id, ok: true, result: validateEnvelope(msg.bytes, opts) };
  } catch (err) {
    reply =
      err instanceof HttpError
        ? { id: msg.id, ok: false, status: err.statusCode, code: err.code, message: err.message }
        : { id: msg.id, ok: false, status: 500, code: 'internal', message: 'validation failed' };
  }
  port.postMessage(reply);
});
