import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { parseAdkIngest } from '@fleetscope/adk-adapter';
import type { SessionStore } from '@fleetscope/session-store';
import type { Collector } from '../collector/collector.js';
import { type EventHub, SESSIONS_TOPIC, sessionTopic } from '../collector/hub.js';

/**
 * The local Agent Viewer API.
 *
 * Small on purpose. Six read endpoints and one ingest endpoint is the entire
 * surface a developer watching one local run needs; anything more would be a
 * platform, which this is explicitly not.
 *
 *   POST /api/ingest                          the ADK plugin's only entry point
 *   GET  /api/health
 *   GET  /api/sessions
 *   GET  /api/sessions/stream                 SSE: the session list changed
 *   GET  /api/sessions/:id
 *   GET  /api/sessions/:id/events
 *   GET  /api/sessions/:id/events/stream      SSE: history + live tail
 */

/** SSE keepalive. Long enough to be quiet, short enough to beat idle proxies. */
const KEEPALIVE_MS = 15_000;

export function viewerRoutes(store: SessionStore, collector: Collector, hub: EventHub): Hono {
  const app = new Hono();

  app.post('/api/ingest', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = parseAdkIngest(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'invalid_ingest',
          problems: parsed.error.issues.map(
            (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          ),
        },
        400,
      );
    }
    const result = collector.ingest(parsed.data);
    return c.json(result, result.isNewSession ? 201 : 200);
  });

  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      framework: 'google-adk',
      sessions: store.listSessions().length,
    }),
  );

  app.get('/api/sessions', (c) => c.json({ sessions: store.listSessions() }));

  app.get('/api/sessions/stream', (c) =>
    streamSSE(c, async (stream) => {
      // The current list first, so a viewer opened at any moment is correct
      // before the first change arrives.
      await stream.writeSSE({
        event: 'sessions',
        data: JSON.stringify({ kind: 'sessions', sessions: store.listSessions() }),
      });
      await pump(stream, hub, SESSIONS_TOPIC, 'sessions');
    }),
  );

  app.get('/api/sessions/:id', (c) => {
    const detail = collector.sessionDetail(c.req.param('id'));
    if (detail === null) return c.json({ error: 'session_not_found' }, 404);
    return c.json(detail);
  });

  app.get('/api/sessions/:id/events', (c) => {
    const id = c.req.param('id');
    if (store.getSession(id) === null) return c.json({ error: 'session_not_found' }, 404);
    const after = Number(c.req.query('after') ?? '-1');
    return c.json({
      sessionId: id,
      events: store.getEvents(id, Number.isFinite(after) ? after : -1),
    });
  });

  app.get('/api/sessions/:id/events/stream', (c) => {
    const id = c.req.param('id');
    if (store.getSession(id) === null) return c.json({ error: 'session_not_found' }, 404);

    // A viewer that opens after the session started, or that reconnects, sends
    // the highest sequence it already holds. `Last-Event-ID` is what the browser
    // resends automatically; `?after=` is the explicit form.
    const lastEventId = c.req.header('Last-Event-ID');
    const requested = Number(c.req.query('after') ?? lastEventId ?? '-1');
    let cursor = Number.isFinite(requested) ? requested : -1;

    return streamSSE(c, async (stream) => {
      // History first, then the live tail. Both are keyed by canonical sequence,
      // so the join point is exact: no gap, and no event delivered twice.
      const history = store.getEvents(id, cursor);
      if (history.length > 0) {
        cursor = history[history.length - 1]!.caseSequence;
        await stream.writeSSE({
          event: 'events',
          id: String(cursor),
          data: JSON.stringify({ kind: 'events', sessionId: id, events: history }),
        });
      }

      await pump(stream, hub, sessionTopic(id), 'events', (raw) => {
        const payload = JSON.parse(raw) as { events: { caseSequence: number }[] };
        const fresh = payload.events.filter((event) => event.caseSequence > cursor);
        if (fresh.length === 0) return null;
        cursor = fresh[fresh.length - 1]!.caseSequence;
        return { id: String(cursor), data: JSON.stringify({ ...payload, events: fresh }) };
      });
    });
  });

  return app;
}

type SseStream = Parameters<Parameters<typeof streamSSE>[1]>[0];

/**
 * Hold the connection open, forwarding hub publications until the client goes.
 *
 * `filter` lets a stream drop what the client already has — the de-duplication
 * that makes "history then live tail" safe against a race with an in-flight
 * ingest.
 */
async function pump(
  stream: SseStream,
  hub: EventHub,
  topic: string,
  event: string,
  filter?: (raw: string) => { id: string; data: string } | null,
): Promise<void> {
  const queue: { id?: string; data: string }[] = [];
  let wake: (() => void) | null = null;

  const unsubscribe = hub.subscribe({
    topic,
    send: (data) => {
      const shaped = filter === undefined ? { data } : filter(data);
      if (shaped === null) return;
      queue.push(shaped);
      wake?.();
    },
  });

  stream.onAbort(() => {
    unsubscribe();
    wake?.();
  });

  try {
    while (!stream.aborted && !stream.closed) {
      while (queue.length > 0) {
        const next = queue.shift()!;
        await stream.writeSSE({ event, ...next });
      }
      if (stream.aborted || stream.closed) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, KEEPALIVE_MS).unref?.();
      });
      wake = null;
      if (queue.length === 0 && !stream.aborted && !stream.closed) {
        // A comment frame, not an event: it keeps proxies from reaping an idle
        // connection without ever looking like data to the client.
        await stream.writeSSE({ event: 'ping', data: '{}' });
      }
    }
  } finally {
    unsubscribe();
  }
}
