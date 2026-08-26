import { canonicalizeAppend, streamRevisionOf } from '@fleetscope/canonicalizer';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { project } from '@fleetscope/projector';
import {
  compileZoetropeScene,
  validateRenderManifest,
  type RenderManifestEntry,
} from '@fleetscope/scenario-compiler';

/**
 * The browser half of the bounded live proof.
 *
 * # The ordering that matters
 *
 *   POST /live/decision → Source Events
 *     → canonicalize onto the EXISTING stream
 *     → project
 *     → compile
 *     → append to the renderer
 *
 * A model result never reaches an authoritative surface directly. It becomes
 * canonical evidence first, through the same pipeline recorded evidence goes
 * through, or it does not appear at all. Rendering the raw response and
 * canonicalizing afterwards would make the model's word authoritative for the
 * length of one frame, which is exactly long enough to be the thing a viewer
 * remembers.
 *
 * # No credential lives here
 *
 * This module talks to the FleetScope API, never to a model vendor. There is no
 * code path in the browser bundle that holds, reads, or transmits a model API
 * key — the key exists only in the server process.
 */

export type LiveAvailability =
  | { readonly state: 'ready'; readonly model: string; readonly maxCallsPerCase: number }
  | { readonly state: 'unavailable'; readonly reason: string };

export interface LiveStepRef {
  readonly caseId: string;
  readonly stepId: string;
}

interface CapabilityResponse {
  liveMode?: unknown;
  model?: unknown;
  limits?: { maxCallsPerCase?: unknown };
  allowlistedSteps?: { caseId?: unknown; stepId?: unknown }[];
}

/**
 * Ask the API what it can actually prove.
 *
 * Capability is READ FROM THE SERVER, never inferred from frontend config: a
 * `PUBLIC_LIVE_MODE=true` build pointed at a server with live mode off would
 * otherwise offer a button that cannot work.
 */
export async function probeLiveCapability(
  apiBaseUrl: string | null,
  step: LiveStepRef,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveAvailability> {
  if (apiBaseUrl === null || apiBaseUrl === '') {
    return {
      state: 'unavailable',
      reason:
        'No FleetScope API is configured for this build. The recorded Case is complete without one.',
    };
  }
  let body: CapabilityResponse;
  try {
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/capability`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        state: 'unavailable',
        reason: 'The FleetScope API did not report its capabilities.',
      };
    }
    body = (await response.json()) as CapabilityResponse;
  } catch {
    return {
      state: 'unavailable',
      reason: 'The FleetScope API is not reachable from this browser.',
    };
  }

  if (body.liveMode !== true) {
    return { state: 'unavailable', reason: 'Live mode is disabled on the FleetScope API.' };
  }
  const allowed = (body.allowlistedSteps ?? []).some(
    (entry) => entry.caseId === step.caseId && entry.stepId === step.stepId,
  );
  if (!allowed) {
    return {
      state: 'unavailable',
      reason: 'This step is not on the server’s live allowlist. There is no free-form live path.',
    };
  }
  return {
    state: 'ready',
    model: typeof body.model === 'string' ? body.model : 'unknown',
    maxCallsPerCase:
      typeof body.limits?.maxCallsPerCase === 'number' ? body.limits.maxCallsPerCase : 1,
  };
}

export interface LiveUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface LiveDecisionResponse {
  readonly mode: 'live' | 'recorded';
  readonly fellBackToRecorded: boolean;
  readonly sourceEvents: readonly unknown[];
  readonly usage?: LiveUsage;
  readonly durationMs?: number;
  readonly callsUsed?: number;
  readonly modelReference?: { readonly model: string; readonly responseRef: string };
  readonly failure?: { readonly reason: string; readonly detail: string };
  readonly message?: string;
}

export type LiveRequestOutcome =
  | { readonly ok: true; readonly response: LiveDecisionResponse }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly detail: string;
      readonly budgetExhausted: boolean;
    };

/**
 * Ask the API for one bounded decision.
 *
 * The endpoint accepts a `(caseId, stepId)` pair and never a prompt — there is
 * no client-supplied text on this path at all, which is what keeps both the
 * spend and the injection surface bounded to what the server itself wrote.
 *
 * Errors are classified into safe, already-structured fields. A raw vendor error
 * body, a stack trace or a filesystem path is never surfaced.
 */
export async function requestLiveDecision(
  apiBaseUrl: string,
  step: LiveStepRef,
  context: { readonly sessionId: string | null; readonly afterSourceTime: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<LiveRequestOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/live/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        caseId: step.caseId,
        stepId: step.stepId,
        sessionId: context.sessionId,
        afterSourceTime: context.afterSourceTime,
      }),
    });
  } catch {
    return {
      ok: false,
      reason: 'api_unreachable',
      detail: 'The FleetScope API is not reachable from this browser.',
      budgetExhausted: false,
    };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> &
    Partial<LiveDecisionResponse>;

  if (!response.ok) {
    const error = typeof body['error'] === 'string' ? body['error'] : 'live_unavailable';
    return {
      ok: false,
      reason: error,
      detail:
        error === 'call_budget_exhausted'
          ? 'The live proof limit for this Case has been reached. FleetScope does not retry.'
          : error === 'live_mode_disabled'
            ? 'Live mode is disabled on the FleetScope API.'
            : error === 'step_not_allowlisted'
              ? 'This step is not on the server’s live allowlist.'
              : 'The FleetScope API declined the live proof.',
      budgetExhausted: error === 'call_budget_exhausted',
    };
  }

  return { ok: true, response: body as LiveDecisionResponse };
}

export interface AppendPlan {
  readonly appendedEvents: readonly CanonicalEvent[];
  readonly stream: readonly CanonicalEvent[];
  readonly mainTail: string;
  readonly subagentsJson: string;
  readonly newManifestEntries: readonly RenderManifestEntry[];
  readonly streamRevision: string;
  readonly stateHash: string;
  readonly rendererEntriesBefore: number;
  readonly rendererEntriesAfter: number;
  /** Anything that would make the append unsafe. Non-empty means: do not apply. */
  readonly problems: readonly string[];
}

/**
 * Turn Source Events into an append the renderer can accept — or refuse.
 *
 * The checks are the same ones `scripts/verify-live-append.ts` runs on the
 * server side, performed again here because THIS is the copy of the pipeline the
 * demo actually shows. In particular the recorded prefix must recompile
 * byte-identically: a live append that rewrote settled evidence would invalidate
 * every hash, manifest range and cursor position already on screen.
 */
export function planAppend(
  existing: readonly CanonicalEvent[],
  sourceEvents: readonly unknown[],
  caseId: string,
): AppendPlan {
  const appended = canonicalizeAppend(existing, sourceEvents, caseId, {
    acceptedTimeFor: (event) => event.ingestionTime ?? event.sourceTime,
  });

  const before = compileZoetropeScene(existing);
  const after = compileZoetropeScene(appended.stream);
  const projected = project(appended.stream);

  const problems: string[] = [];
  if (appended.rejected.length > 0) {
    problems.push(
      `The canonicalizer rejected ${appended.rejected.length} event(s): ${appended.rejected
        .map((rejection) => rejection.reason)
        .join(', ')}.`,
    );
  }
  if (appended.streamProblems.length > 0) {
    problems.push(`Stream problems: ${appended.streamProblems.join('; ')}.`);
  }
  if (!after.main.startsWith(before.main)) {
    problems.push('The recorded prefix recompiled differently. The append was refused.');
  }
  if (validateRenderManifest(after.manifest).length > 0) {
    problems.push(
      'The extended Render Manifest is internally inconsistent. The append was refused.',
    );
  }
  if (after.invariantViolations.length > 0) {
    problems.push('A security-ordering invariant was violated. The append was refused.');
  }
  if (projected.state.invariantViolations.length > 0) {
    problems.push('The projection recorded an invariant violation. The append was refused.');
  }

  return {
    appendedEvents: appended.appended,
    stream: appended.stream,
    mainTail: after.main.slice(before.main.length),
    subagentsJson: JSON.stringify(after.subagents),
    newManifestEntries: after.manifest.entries.slice(before.manifest.entries.length),
    streamRevision:
      appended.streamRevision === '' ? streamRevisionOf(appended.stream) : appended.streamRevision,
    stateHash: projected.stateHash,
    rendererEntriesBefore: before.manifest.rendererEntryCount,
    rendererEntriesAfter: after.manifest.rendererEntryCount,
    problems,
  };
}
