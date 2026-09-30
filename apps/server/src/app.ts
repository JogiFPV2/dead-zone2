import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, type HealthResponse } from '@deadzone/protocol';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', (): HealthResponse => ({ status: 'ok', protocolVersion: PROTOCOL_VERSION }));

  return app;
}
