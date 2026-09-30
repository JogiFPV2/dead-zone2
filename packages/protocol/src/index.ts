/** Bump on every breaking change to commands or snapshots. */
export const PROTOCOL_VERSION = 1;

/** Player intent sent to the simulation (PLAN.md: commands instead of direct state changes). */
export type Command = { type: 'move'; tick: number; dx: number; dy: number };

export interface HealthResponse {
  status: 'ok';
  protocolVersion: number;
}
