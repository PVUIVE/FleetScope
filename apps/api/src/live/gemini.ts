import { z } from 'zod';
import type { FleetScopeConfig } from '@fleetscope/shared';
import { assertLiveModeEnabled } from '@fleetscope/shared';
import type { LiveStep } from './allowlist.js';

/**
 * The bounded model call.
 *
 * Every limit that keeps this affordable and safe is enforced HERE, at the only
 * place an outbound model request can originate:
 *
 *   - the prompt is server-owned and selected by an allowlisted step id. There
 *     is no endpoint anywhere in this service that accepts prompt text;
 *   - the response must satisfy a schema, or it is a failure. A model that
 *     returns prose where FleetScope asked for a classification has not
 *     succeeded in a way that is merely inconvenient — it has not succeeded;
 *   - temperature is the lowest the API allows, so two runs of the same step are
 *     as close to identical as the provider permits;
 *   - input and output token ceilings, one hard timeout, and NO retry. A retry
 *     doubles the spend for the same evidence, and the recorded fallback is
 *     already correct, so retrying buys nothing and risks the budget.
 *
 * The result is ADVICE. It becomes canonical evidence and it is recorded, but it
 * grants no Runtime authority and the Policy Engine will not raise a disposition
 * because of it.
 */

/** Google's Generative Language API. No SDK: one fetch, one shape, no surprises. */
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * What FleetScope will accept back. Anything else is a failed call.
 *
 * Deliberately small and closed: the fields are operator-safe by construction,
 * so there is no path by which model prose reaches a renderer or an audit record
 * unbounded.
 */
export const liveDecisionSchema = z
  .object({
    /** One of a closed set. Never free text. */
    classification: z.enum(['compliant', 'needs_review', 'non_compliant', 'insufficient_evidence']),
    /** A concise operator-safe summary. NOT reasoning, and length-capped. */
    summary: z.string().min(1).max(280),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type LiveDecision = z.infer<typeof liveDecisionSchema>;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    classification: {
      type: 'STRING',
      enum: ['compliant', 'needs_review', 'non_compliant', 'insufficient_evidence'],
    },
    summary: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['classification', 'summary', 'confidence'],
} as const;

/**
 * The server-owned prompts, keyed by allowlisted step.
 *
 * They describe the recorded Case in FleetScope's own words and ask for a
 * classification. They carry no vendor content, no credentials and no operator
 * text — a live proof must not become an exfiltration path for the Case.
 */
const PROMPTS: Readonly<Record<string, string>> = {
  'orchestrator-compliance-decision': [
    'You are assisting a governed enterprise agent-fleet control plane.',
    'A vendor onboarding case has completed these recorded steps: an ERP inventory read',
    'authorized by Agent Identity; a Memory Bank write recording agreed commercial terms;',
    'a Model Armor block of a malicious vendor input, which was therefore never used;',
    'a delegated logistics lead-time check that failed three times and then succeeded',
    'after one bounded retry; and an operator-approved ERP vendor activation.',
    'Classify the compliance posture of this case from that evidence alone.',
    'Do not speculate about anything not listed. Answer only in the required JSON shape.',
  ].join(' '),
  'warden-incident-advice': [
    'You are advising, not deciding, inside a governed enterprise agent-fleet control plane.',
    'An idempotent read-only logistics tool failed three times with the same upstream',
    'timeout error class, then succeeded after one bounded retry that a deterministic',
    'policy authorized. Classify whether this incident is resolved from that evidence',
    'alone. Your answer is advisory only and grants no authority to act.',
    'Answer only in the required JSON shape.',
  ].join(' '),
};

export type LiveFailureReason =
  'not_configured' | 'timeout' | 'transport' | 'http_error' | 'schema_invalid' | 'no_candidate';

export interface LiveSuccess {
  readonly ok: true;
  readonly decision: LiveDecision;
  readonly model: string;
  /** A verifiable handle for the response, for the audit record. */
  readonly responseRef: string;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  };
  readonly durationMs: number;
}

export interface LiveFailure {
  readonly ok: false;
  readonly reason: LiveFailureReason;
  /** Safe to record and display. Never carries a credential or a raw response. */
  readonly detail: string;
  readonly durationMs: number;
}

export type LiveOutcome = LiveSuccess | LiveFailure;

export interface GeminiDependencies {
  /** Injected so the bounded call can be tested without a network or a key. */
  readonly fetch: typeof globalThis.fetch;
  /** Elapsed milliseconds. Injected so a test does not depend on wall time. */
  readonly elapsedMs: () => number;
  readonly apiKey: string | null;
}

/**
 * Call the model once, within every bound.
 *
 * Returns a failure rather than throwing: the caller's job on failure is to
 * serve recorded evidence, and an exception would make that the exceptional path
 * rather than the designed one.
 */
export async function requestLiveDecision(
  config: FleetScopeConfig,
  step: LiveStep,
  dependencies: GeminiDependencies,
): Promise<LiveOutcome> {
  // Belt and braces: throws if any future refactor lets a caller reach this
  // without passing the admission gate.
  assertLiveModeEnabled(config, `live.${step.stepId}`);

  const startedAt = dependencies.elapsedMs();
  const elapsed = (): number => dependencies.elapsedMs() - startedAt;

  const model = config.gemini.model;
  const prompt = PROMPTS[step.stepId];
  if (model === null || dependencies.apiKey === null || prompt === undefined) {
    return {
      ok: false,
      reason: 'not_configured',
      detail: 'Live mode is on but the model, the credential, or the step prompt is missing.',
      durationMs: elapsed(),
    };
  }

  // A crude but honest input ceiling. The prompt is a server constant, so this
  // can only fail if someone edits one past the budget — which is exactly when
  // it should fail, at the boundary rather than on the invoice.
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  if (estimatedInputTokens > config.gemini.maxInputTokens) {
    return {
      ok: false,
      reason: 'not_configured',
      detail: `The step prompt exceeds GEMINI_MAX_INPUT_TOKENS (${config.gemini.maxInputTokens}).`,
      durationMs: elapsed(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.gemini.timeoutMs);

  try {
    const response = await dependencies.fetch(
      `${API_ROOT}/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          // The credential travels in a header, never in the URL: a URL reaches
          // proxy logs, browser history and error reports.
          'x-goog-api-key': dependencies.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: config.gemini.temperature,
            maxOutputTokens: config.gemini.maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            candidateCount: 1,
          },
        }),
      },
    );

    if (!response.ok) {
      // The status is safe to record; the body is not, so it is not read.
      return {
        ok: false,
        reason: 'http_error',
        detail: `The model API returned HTTP ${response.status}.`,
        durationMs: elapsed(),
      };
    }

    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      responseId?: string;
    };

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || text === '') {
      return {
        ok: false,
        reason: 'no_candidate',
        detail: 'The model returned no candidate.',
        durationMs: elapsed(),
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return {
        ok: false,
        reason: 'schema_invalid',
        detail: 'The model response was not valid JSON.',
        durationMs: elapsed(),
      };
    }

    const decision = liveDecisionSchema.safeParse(parsedJson);
    if (!decision.success) {
      // The problems name FIELDS, never values: an invalid response may still
      // contain content that must not be echoed into a log or an audit record.
      return {
        ok: false,
        reason: 'schema_invalid',
        detail: `The model response did not match the required shape: ${decision.error.issues
          .map((issue: { path: PropertyKey[] }) => issue.path.join('.') || '<root>')
          .join(', ')}.`,
        durationMs: elapsed(),
      };
    }

    return {
      ok: true,
      decision: decision.data,
      model,
      responseRef: body.responseId ?? `${model}:${step.stepId}`,
      usage: {
        inputTokens: body.usageMetadata?.promptTokenCount ?? null,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? null,
      },
      durationMs: elapsed(),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      reason: aborted ? 'timeout' : 'transport',
      detail: aborted
        ? `The model call exceeded the ${config.gemini.timeoutMs}ms timeout and was aborted.`
        : 'The model call could not be completed.',
      durationMs: elapsed(),
    };
  } finally {
    // NO RETRY. The recorded fallback is already correct, so a retry would spend
    // twice for evidence FleetScope can serve for nothing.
    clearTimeout(timer);
  }
}
