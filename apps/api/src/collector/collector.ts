import { canonicalizeAppend } from '@fleetscope/canonicalizer';
import { caseIdForSession, toSourceEvents, type AdkIngest } from '@fleetscope/adk-adapter';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { type SessionStore } from '@fleetscope/session-store';
import { buildAgentTree, projectViewerEvents, summarizeSession } from '@fleetscope/viewer';
import { type EventHub, SESSIONS_TOPIC, sessionTopic } from './hub.js';

/**
 * The Collector: the one place a framework event becomes FleetScope evidence.
 *
 * The order below is the product's central security and correctness guarantee
 * and must not be rearranged:
 *
 *     ADK wire event → Source Event → canonicalize (REDACT) → persist → publish
 *
 * Redaction happens inside `canonicalizeAppend`, BEFORE anything touches disk
 * and before anything reaches a browser. A credential that arrived in a tool
 * argument is never written and never streamed.
 */

export interface IngestResult {
  readonly sessionId: string;
  readonly caseId: string;
  readonly accepted: number;
  readonly rejected: readonly { reason: string; detail: string }[];
  readonly isNewSession: boolean;
}

export class Collector {
  constructor(
    private readonly store: SessionStore,
    private readonly hub: EventHub,
    /** Injected so tests can drive the receipt clock without a real one. */
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  ingest(batch: AdkIngest): IngestResult {
    const sessionId = batch.sessionId;
    const caseId = caseIdForSession(sessionId);
    const existingSession = this.store.getSession(sessionId);
    const isNewSession = existingSession === null;

    const sourceEvents = toSourceEvents(batch, this.store.knownAgents(sessionId));
    const existing = this.store.getEvents(sessionId);
    const ingestedAt = this.now();

    const result = canonicalizeAppend(existing, sourceEvents, caseId, {
      // The receipt time is a fact this edge observed. The Canonicalizer reads
      // no clock of its own — see packages/canonicalizer.
      acceptedTimeFor: () => ingestedAt,
      ingestionTimeFor: () => ingestedAt,
    });

    if (result.appended.length > 0) {
      this.store.appendEvents(sessionId, result.appended);
    }

    const stream = result.stream as CanonicalEvent[];
    const rows = projectViewerEvents(stream);
    const name = batch.appName ?? summarizeName(stream) ?? sessionId;
    const summary = summarizeSession(sessionId, name, batch.framework, stream, rows);

    this.store.upsertSession({
      id: sessionId,
      caseId,
      name,
      framework: batch.framework,
      frameworkVersion: batch.frameworkVersion ?? null,
      rootAgent: summary.rootAgent,
      status: summary.status,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      eventCount: stream.length,
      createdAt: existingSession?.createdAt ?? ingestedAt,
    });

    if (result.appended.length > 0) {
      // Canonical events on the wire, not viewer rows: the browser holds the
      // canonical stream so it can compile the renderer scene and project the
      // timeline from any prefix without asking the server again.
      this.hub.publish(sessionTopic(sessionId), {
        kind: 'events',
        sessionId,
        events: result.appended,
      });
    }
    // The list refreshes on every batch, not only on creation: status, event
    // count and duration all change while a session runs.
    this.hub.publish(SESSIONS_TOPIC, { kind: 'sessions', sessions: this.store.listSessions() });

    return {
      sessionId,
      caseId,
      accepted: result.appended.length,
      rejected: result.rejected.map((r) => ({ reason: r.reason, detail: r.detail })),
      isNewSession,
    };
  }

  /** Everything the Agent Viewer needs for one session, in one read. */
  sessionDetail(sessionId: string): {
    session: ReturnType<typeof summarizeSession>;
    agents: ReturnType<typeof buildAgentTree>;
    events: CanonicalEvent[];
  } | null {
    const row = this.store.getSession(sessionId);
    if (row === null) return null;
    const events = this.store.getEvents(sessionId);
    const rows = projectViewerEvents(events);
    return {
      session: summarizeSession(sessionId, row.name, row.framework, events, rows),
      agents: buildAgentTree(events, rows),
      events,
    };
  }
}

/** Fall back to the root agent's own name when the framework named no app. */
function summarizeName(events: readonly CanonicalEvent[]): string | null {
  const spawn = events.find(
    (e) => e.type === 'agent.spawned' && e.correlations['parentAgentInstanceId'] === undefined,
  );
  const role = spawn?.payloadRedacted['role'];
  return typeof role === 'string' && role !== '' ? role : null;
}
