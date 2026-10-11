// Types of the generated bundle `server.js` (apps/server/src/edge.ts).
export function createEdgeHandler(
  env: Readonly<Record<string, string | undefined>>,
): (req: Request, info?: { remoteAddr?: { hostname?: string } }) => Promise<Response>;
