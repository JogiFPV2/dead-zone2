/** Bump on every breaking change to commands, snapshots or worker messages. */
export const PROTOCOL_VERSION = 40;

export * from './api.js';
export * from './commands.js';
export * from './events.js';
export * from './map.js';
export * from './snapshot.js';
export * from './sun.js';
export * from './vehicles.js';
export * from './views.js';
export * from './worker-messages.js';
export * from './world.js';

export interface HealthResponse {
  status: 'ok';
  protocolVersion: number;
}
