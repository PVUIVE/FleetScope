import { describe, expect, it } from 'vitest';
import { parseConfig } from '@fleetscope/shared';
import { SessionStore } from '@fleetscope/session-store';
import { createApp } from '../src/app.js';
import { Collector } from '../src/collector/collector.js';
import { EventHub, SESSIONS_TOPIC, sessionTopic } from '../src/collector/hub.js';

/**
 * The local Agent Viewer API, exercised through the real app.
 *
 * The store is in memory and the clock is injected, so these prove the ingest
 * ORDER — validate, canonicalize (redact), persist, publish — without a file, a
 * network, or a real agent.
 */
function harness() {
  const parsed = parseConfig({ APP_ENV: 'test', API_LOG_LEVEL: 'silent' });
  if (!parsed.ok) throw new Error(parsed.error.join('; '));
  const store = SessionStore.open(':memory:');
  const hub = new EventHub();
  let tick = 0;
  const collector = new Collector(
    store,
    hub,
    () => `2026-08-28T12:00:${String(tick++).padStart(2, '0')}.000Z`,
  );
  const app = createApp(parsed.value, 'silent', undefined, { store, collector, hub });
  return { app, store, hub, collector };
}

const at = (n: number): string => `2026-08-28T10:00:0${n}.000Z`;

const batch = (events: unknown[], sessionId = 'ses_1'): Request =>
  new Request('http://local/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ framework: 'google-adk', sessionId, appName: 'Demo', events }),
  });

const GOLDEN = [
  { kind: 'session.start', seq: 0, at: at(0), agent: 'root' },
  { kind: 'agent.start', seq: 1, at: at(1), agent: 'root' },
  { kind: 'tool.start', seq: 2, at: at(2), agent: 'root', tool: 'lookup', callId: 't1' },
  {
    kind: 'tool.end',
    seq: 3,
    at: at(3),
    agent: 'root',
    tool: 'lookup',
    callId: 't1',
    error: true,
    errorClass: 'timeout',
  },
  { kind: 'session.end', seq: 4, at: at(4), agent: 'root' },
];

describe('POST /api/ingest', () => {
  it('accepts a real ADK batch and reports what it stored', async () => {
    const { app } = harness();
    const response = await app.request(batch(GOLDEN));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { accepted: number; rejected: unknown[] };
    expect(body.accepted).toBe(6);
    expect(body.rejected).toEqual([]);
  });

  it('rejects a malformed batch with the problems named', async () => {
    const { app } = harness();
    const response = await app.request(
      new Request('http://local/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'x', events: [{ kind: 'nope', seq: 0, at: at(0) }] }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; problems: string[] };
    expect(body.error).toBe('invalid_ingest');
    expect(body.problems.length).toBeGreaterThan(0);
  });

  it('is idempotent, so a client retry cannot double an event', async () => {
    const { app, store } = harness();
    await app.request(batch(GOLDEN));
    const second = await app.request(batch(GOLDEN));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { accepted: number }).accepted).toBe(0);
    expect(store.getEvents('ses_1')).toHaveLength(6);
  });

  it('redacts a credential BEFORE it is persisted', async () => {
    const { app, store } = harness();
    await app.request(
      batch([
        {
          kind: 'tool.start',
          seq: 0,
          at: at(0),
          agent: 'root',
          tool: 'call',
          callId: 'c',
          args: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz012345', vendor: 'Acme' },
        },
      ]),
    );
    const stored = store.getEvents('ses_1')[0];
    const args = stored?.payloadRedacted['args'] as Record<string, unknown>;
    expect(args['authorization']).toBe('«redacted»');
    expect(args['vendor']).toBe('Acme');
    // Nothing anywhere in the stored bytes may still carry the token.
    expect(JSON.stringify(stored)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});

describe('the read endpoints', () => {
  it('summarizes a session from its stored evidence', async () => {
    const { app } = harness();
    await app.request(batch(GOLDEN));
    const response = await app.request('http://local/api/sessions/ses_1');
    const body = (await response.json()) as {
      session: { status: string; errorCount: number; rootAgent: string };
      agents: { id: string }[];
      events: unknown[];
    };
    expect(body.session.status).toBe('completed');
    expect(body.session.errorCount).toBe(1);
    expect(body.session.rootAgent).toBe('root');
    expect(body.agents.map((a) => a.id)).toEqual(['root']);
    expect(body.events).toHaveLength(6);
  });

  it('serves the tail a reconnecting client asks for', async () => {
    const { app } = harness();
    await app.request(batch(GOLDEN));
    const response = await app.request('http://local/api/sessions/ses_1/events?after=3');
    const body = (await response.json()) as { events: { caseSequence: number }[] };
    expect(body.events.map((e) => e.caseSequence)).toEqual([4, 5]);
  });

  it('404s an unknown session rather than inventing an empty one', async () => {
    const { app } = harness();
    expect((await app.request('http://local/api/sessions/ghost')).status).toBe(404);
    expect((await app.request('http://local/api/sessions/ghost/events')).status).toBe(404);
  });

  it('reports health without any session at all', async () => {
    const { app } = harness();
    const body = (await (await app.request('http://local/api/health')).json()) as {
      status: string;
      sessions: number;
    };
    expect(body).toEqual({ status: 'ok', framework: 'google-adk', sessions: 0 });
  });
});

describe('the live hub', () => {
  it('publishes appended events and the changed session list', async () => {
    const { app, hub } = harness();
    const events: unknown[] = [];
    const sessions: unknown[] = [];
    hub.subscribe({ topic: sessionTopic('ses_1'), send: (data) => events.push(JSON.parse(data)) });
    hub.subscribe({ topic: SESSIONS_TOPIC, send: (data) => sessions.push(JSON.parse(data)) });

    await app.request(batch(GOLDEN));

    expect((events[0] as { events: unknown[] }).events).toHaveLength(6);
    expect(sessions).toHaveLength(1);
  });

  it('publishes the session list on every batch, not only on creation', async () => {
    const { app, hub } = harness();
    const sessions: unknown[] = [];
    hub.subscribe({ topic: SESSIONS_TOPIC, send: (data) => sessions.push(JSON.parse(data)) });
    await app.request(batch(GOLDEN.slice(0, 2)));
    await app.request(batch(GOLDEN.slice(2)));
    expect(sessions).toHaveLength(2);
  });

  it('drops a subscriber whose socket has gone rather than failing the ingest', async () => {
    const { app, hub } = harness();
    hub.subscribe({
      topic: SESSIONS_TOPIC,
      send: () => {
        throw new Error('socket closed');
      },
    });
    const response = await app.request(batch(GOLDEN));
    expect(response.status).toBe(201);
    expect(hub.subscriberCount(SESSIONS_TOPIC)).toBe(0);
  });

  it('unsubscribes cleanly', () => {
    const { hub } = harness();
    const stop = hub.subscribe({ topic: 'x', send: () => {} });
    expect(hub.subscriberCount('x')).toBe(1);
    stop();
    expect(hub.subscriberCount('x')).toBe(0);
  });
});

describe('a session that arrives in pieces', () => {
  it('keeps one canonical stream across batches, with sequences continuing', async () => {
    const { app, store } = harness();
    for (const event of GOLDEN) await app.request(batch([event]));
    const stored = store.getEvents('ses_1');
    expect(stored.map((e) => e.caseSequence)).toEqual([0, 1, 2, 3, 4, 5]);
    // The root agent is spawned once, on its first activation, and never again.
    expect(stored.filter((e) => e.type === 'agent.spawned')).toHaveLength(1);
  });
});
