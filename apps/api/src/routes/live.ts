import { Hono } from 'hono';
import { admitLiveRequest, liveCallsUsed } from '../live/guard.js';
import { requestLiveDecision, type GeminiDependencies } from '../live/gemini.js';
import { liveFailureEvidence, liveSuccessEvidence } from '../live/evidence.js';
import type { FleetScopeConfig } from '../config/index.js';

/**
 * The single bounded live-proof endpoint.
 *
 * It accepts an allowlisted `(caseId, stepId)` pair — **never a prompt**. There
 * is no endpoint in this service that takes prompt text, which is what keeps
 * both the spend and the injection surface bounded to what the server itself
 * wrote.
 *
 * # What it returns, and what the client does with it
 *
 * Source Events. Not a rendered result, not model prose, not an instruction. The
 * client canonicalizes them onto its existing stream, projects, compiles, and
 * appends to the renderer — the same pipeline recorded evidence goes through.
 * That ordering is the whole point: a live result becomes canonical evidence
 * BEFORE it can affect an authoritative surface.
 *
 * # When it fails
 *
 * It returns 200 with `mode: "recorded"` and the failure recorded as evidence.
 * A failed live proof is a fact worth keeping, and the recorded path is already
 * correct — so the demo continues, honestly labelled, without a retry.
 */
export function liveRoutes(
  config: FleetScopeConfig,
  dependencies?: Partial<GeminiDependencies>,
): Hono {
  const app = new Hono();

  app.post('/live/decision', async (c) => {
    type LiveRequestBody = {
      caseId?: unknown;
      stepId?: unknown;
      sessionId?: unknown;
      afterSourceTime?: unknown;
    };
    const body: LiveRequestBody = await c.req
      .json<LiveRequestBody>()
      .catch((): LiveRequestBody => ({}));
    const caseId = typeof body.caseId === 'string' ? body.caseId : '';
    const stepId = typeof body.stepId === 'string' ? body.stepId : '';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    // The client holds the canonical stream, so it knows where its Case's own
    // clock has reached. See the `observedAt` derivation below.
    const afterSourceTime = typeof body.afterSourceTime === 'string' ? body.afterSourceTime : null;

    if (caseId === '' || stepId === '') {
      return c.json({ error: 'caseId and stepId are required' }, 400);
    }

    const admission = admitLiveRequest(config, caseId, stepId);
    if (!admission.admitted) {
      // The client must render recorded evidence. It is told so in a
      // machine-readable way so the fallback needs no UI special case.
      const status = admission.rejection.reason === 'step_not_allowlisted' ? 403 : 409;
      return c.json(
        {
          error: admission.rejection.reason,
          liveMode: config.liveMode,
          fallback: 'recorded',
          message:
            'Live proof unavailable. The client must render recorded evidence for this step.',
        },
        status,
      );
    }

    const step = admission.step;

    // Two clocks, kept apart.
    //
    // `ingestedAt` is real: when this edge took delivery. `observedAt` is the
    // time inside the CASE, which for a Recorded Case runs a simulated timeline
    // that may sit ahead of or behind wall time. Appending a live proof stamped
    // at wall time would either misdate it inside the Case or be rejected as a
    // late arrival against evidence already recorded — so it is placed just
    // after the Case's own high-water mark when the client supplies one.
    //
    // The Canonicalizer reads no clock at all; both values are facts this edge
    // observes and passes in.
    const ingestedAt = new Date().toISOString();
    const afterMs = afterSourceTime === null ? Number.NaN : Date.parse(afterSourceTime);
    const observedAt = Number.isFinite(afterMs)
      ? new Date(Math.max(afterMs + 1000, Date.parse(ingestedAt))).toISOString()
      : ingestedAt;

    const outcome = await requestLiveDecision(config, step, {
      fetch: dependencies?.fetch ?? globalThis.fetch,
      elapsedMs: dependencies?.elapsedMs ?? (() => performance.now()),
      apiKey: dependencies?.apiKey ?? config.gemini.apiKey,
    });

    const context = {
      step,
      sessionId,
      agentInstanceId: 'agent-orchestrator-1',
      observedAt,
      ingestedAt,
    };

    if (!outcome.ok) {
      return c.json({
        mode: 'recorded' as const,
        fellBackToRecorded: true,
        caseId,
        stepId,
        // Honest: the attempt happened and failed, and both facts are evidence.
        failure: { reason: outcome.reason, detail: outcome.detail, durationMs: outcome.durationMs },
        sourceEvents: liveFailureEvidence(context, outcome),
        callsUsed: liveCallsUsed(caseId),
        message:
          'The live proof did not succeed. The failure is recorded as evidence and the recorded result stands.',
      });
    }

    return c.json({
      mode: 'live' as const,
      fellBackToRecorded: false,
      caseId,
      stepId,
      modelReference: { model: outcome.model, responseRef: outcome.responseRef },
      usage: outcome.usage,
      durationMs: outcome.durationMs,
      sourceEvents: liveSuccessEvidence(context, outcome),
      callsUsed: liveCallsUsed(caseId),
      message:
        'Live result returned as Source Events. Canonicalize before it affects any authoritative surface.',
    });
  });

  return app;
}
