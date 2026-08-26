import type { LiveStep } from '../live/allowlist.js';

/**
 * The shape the live endpoint returns. It is Decision Evidence, not model output:
 * the caller gets recorded facts and a concise operator-safe summary, never a
 * reasoning chain, and never an instruction the browser is expected to obey.
 */
export interface LiveDecisionEvidence {
  readonly caseId: string;
  readonly stepId: string;
  readonly mode: 'live' | 'recorded';
  readonly proves: string;
  readonly summary: string;
  readonly modelReference: { readonly model: string; readonly responseRef: string } | null;
  readonly observedAt: string;
  /** True when the live path was unavailable and recorded evidence was served. */
  readonly fellBackToRecorded: boolean;
}

export function recordedFallback(step: LiveStep, reason: string): LiveDecisionEvidence {
  return {
    caseId: step.caseId,
    stepId: step.stepId,
    mode: 'recorded',
    proves: step.proves,
    summary: `Recorded evidence served: ${reason}`,
    modelReference: null,
    observedAt: new Date().toISOString(),
    fellBackToRecorded: true,
  };
}
