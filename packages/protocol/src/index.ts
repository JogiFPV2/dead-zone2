/** Bump on every breaking change to commands or snapshots. */
export const PROTOCOL_VERSION = 2;

export * from './commands.js';
export * from './events.js';
export * from './map.js';
export * from './snapshot.js';
export * from './worker-messages.js';

export interface HealthResponse {
  status: 'ok';
  protocolVersion: number;
}
