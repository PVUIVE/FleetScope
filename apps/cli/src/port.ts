import { createServer } from 'node:net';

/**
 * Port checks.
 *
 * A busy port has two very different causes, and conflating them is the bug
 * that spawns duplicate servers: either FleetScope is ALREADY RUNNING there (in
 * which case the right answer is to use it), or something else owns it (in
 * which case the right answer is to say so and stop). Never silently increment
 * to the next free port — the developer's bookmark and their agent's endpoint
 * both point at the one they configured.
 */
export type PortState =
  | { readonly kind: 'free' }
  | { readonly kind: 'fleetscope'; readonly sessions: number }
  | { readonly kind: 'occupied'; readonly detail: string };

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/** Ask a busy port whether it is a FleetScope collector. */
export async function probePort(port: number, host = '127.0.0.1'): Promise<PortState> {
  if (await isPortFree(port, host)) return { kind: 'free' };

  try {
    const response = await fetch(`http://${host}:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok) {
      const body = (await response.json()) as { status?: string; sessions?: number };
      if (body.status === 'ok') {
        return {
          kind: 'fleetscope',
          sessions: typeof body.sessions === 'number' ? body.sessions : 0,
        };
      }
    }
    return { kind: 'occupied', detail: `an HTTP server answered, but it is not FleetScope` };
  } catch {
    return { kind: 'occupied', detail: 'the port is in use by another process' };
  }
}
