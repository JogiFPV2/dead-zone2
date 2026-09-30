import { afterAll, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@deadzone/protocol';
import { buildApp } from './app.js';

const app = buildApp();
afterAll(() => app.close());

it('GET /health returns ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok', protocolVersion: PROTOCOL_VERSION });
});
