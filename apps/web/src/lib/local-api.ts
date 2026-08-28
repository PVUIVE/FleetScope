import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { ViewerAgent, ViewerSession } from '@fleetscope/viewer';

/**
 * The browser's view of the local FleetScope API.
 *
 * The viewer is served BY the collector, from the same origin, so every call
 * here is a same-origin relative path: no configured base URL, no CORS grant,
 * and no way for a page on another site to read a developer's sessions.
 */

export interface SessionRow {
  readonly id: string;
  readonly name: string;
  readonly framework: string;
  readonly frameworkVersion: string | null;
  readonly rootAgent: string | null;
  readonly status: 'running' | 'completed' | 'failed';
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly eventCount: number;
  readonly createdAt: string;
}

export interface SessionDetail {
  readonly session: ViewerSession;
  readonly agents: readonly ViewerAgent[];
  readonly events: readonly CanonicalEvent[];
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

export const fetchSessions = (): Promise<{ sessions: SessionRow[] }> => getJson('/api/sessions');

export const fetchSessionDetail = (id: string): Promise<SessionDetail> =>
  getJson(`/api/sessions/${encodeURIComponent(id)}`);

/**
 * Subscribe to a Server-Sent Events endpoint.
 *
 * `EventSource` reconnects on its own and replays `Last-Event-ID`, which the
 * collector uses to resume exactly where the client left off. The returned
 * function closes the stream — the caller MUST call it on unload, or a
 * navigated-away tab keeps a connection open against the local collector.
 */
export function subscribe(
  path: string,
  event: string,
  onMessage: (data: unknown) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(path);
  source.addEventListener(event, (message) => {
    try {
      onMessage(JSON.parse((message as MessageEvent<string>).data));
    } catch {
      // A malformed frame is dropped rather than allowed to kill the stream:
      // the next one is very likely fine, and the store is authoritative anyway.
    }
  });
  if (onError !== undefined) source.addEventListener('error', onError);
  return () => source.close();
}

/** The session id is in the path because the page is one static shell. */
export function sessionIdFromLocation(pathname: string): string | null {
  const match = /^\/sessions\/([^/]+)\/?$/.exec(pathname);
  const fromPath = match?.[1];
  if (fromPath !== undefined && fromPath !== 'view') return decodeURIComponent(fromPath);
  const query = new URLSearchParams(globalThis.location?.search ?? '');
  return query.get('id');
}
