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
 * The operator-safe summary length, defined ONCE.
 *
 * It is enforced in three places — the prompt asks for it, the provider's
 * response schema constrains generation to it, and Zod rejects anything past it
 * — so a single constant keeps the three from drifting. Measured: asked for a
 * compliance summary with no limit, the model returns ~400 characters, which is
 * a paragraph rather than the one-line summary the evidence rail renders.
 */
const SUMMARY_MAX_CHARS = 280;

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
    summary: z.string().min(1).max(SUMMARY_MAX_CHARS),
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
    // maxLength constrains GENERATION, so the model is steered inside the
    // budget rather than being rejected after spending it.
    summary: { type: 'STRING', maxLength: SUMMARY_MAX_CHARS },
    confidence: { type: 'NUMBER' },
  },
  required: ['classification', 'summary', 'confidence'],
} as const;

/** Appended to every prompt. Says the constraint the schema also enforces. */
const SUMMARY_INSTRUCTION =
  `Keep "summary" under ${SUMMARY_MAX_CHARS} characters — one or two sentences, ` +
  'stating only what the recorded evidence shows.';

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
    SUMMARY_INSTRUCTION,
  ].join(' '),
  'warden-incident-advice': [
    'You are advising, not deciding, inside a governed enterprise agent-fleet control plane.',
    'An idempotent read-only logistics tool failed three times with the same upstream',
    'timeout error class, then succeeded after one bounded retry that a deterministic',
    'policy authorized. Classify whether this incident is resolved from that evidence',
    'alone. Your answer is advisory only and grants no authority to act.',
    'Answer only in the required JSON shape.',
    SUMMARY_INSTRUCTION,
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
 * The machine-readable reason for a failed request.
 *
 * Reads ONLY `error.status` and `error.details[].reason` — both enum-like, both
 * describing the request rather than any response content. Returns null if the
 * body is not the shape expected, because a diagnostic that guesses is worse
 * than one that stays quiet.
 */
async function googleErrorReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      error?: { status?: unknown; details?: { reason?: unknown }[] };
    };
    const status = typeof body.error?.status === 'string' ? body.error.status : null;
    const detail = body.error?.details?.find((d) => typeof d.reason === 'string');
    const reason = typeof detail?.reason === 'string' ? detail.reason : null;
    return reason ?? status;
  } catch {
    return null;
  }
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
            // THINKING IS OFF, and this is load-bearing rather than a tuning
            // preference.
            //
            // Gemini 2.5 models think by default, and thinking tokens count
            // against `maxOutputTokens`. Measured against this exact request:
            // 284 of a 300-token budget went to thoughts, leaving ONE token for
            // the answer — the response came back as the two characters `{"`,
            // which the schema then rejected. The failure is silent in the worst
            // way: the call succeeds, is billed, and yields nothing.
            //
            // It is also the right default on principle. FleetScope records no
            // hidden reasoning and reconstructs none, so paying a model to
            // produce reasoning that is then discarded buys the product nothing
            // and spends the budget it is supposed to be protecting.
            //
            // Not every model honours a zero budget (the Pro tier cannot disable
            // it). Pointing GEMINI_MODEL at one now yields a 400 that names its
            // own reason, thanks to the error handling below.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );

    if (!response.ok) {
      // "HTTP 400" alone is not diagnosable — it is equally an invalid
      // credential, an unsupported generation config, and a malformed schema.
      // Google's structured `status` and `details[].reason` are enum-like
      // metadata: a 4xx carries no candidate, so there is no model content in
      // them to leak. The free-text `message` is NOT read, because that is the
      // field with no such guarantee.
      const reason = await googleErrorReason(response);
      return {
        ok: false,
        reason: 'http_error',
        detail: `The model API returned HTTP ${response.status}${reason === null ? '' : ` (${reason})`}.`,
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
