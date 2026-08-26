import { assertLiveModeEnabled, type FleetScopeConfig } from '@fleetscope/shared';
import { findLiveStep, type LiveStep } from './allowlist.js';

export type LiveRejection =
  | { readonly reason: 'live_mode_disabled' }
  | { readonly reason: 'step_not_allowlisted' }
  | { readonly reason: 'call_budget_exhausted'; readonly limit: number };

export type LiveAdmission =
  | { readonly admitted: true; readonly step: LiveStep }
  | { readonly admitted: false; readonly rejection: LiveRejection };

/**
 * Per-Case call counter enforcing GEMINI_MAX_CALLS_PER_CASE.
 *
 * In-memory on purpose: the MVP runs `max-instances=1` with no datastore, and an
 * in-memory counter that resets on restart is a smaller risk than adding a
 * database to the six-day path. Documented, not hidden.
 */
const callsPerCase = new Map<string, number>();

export function resetLiveCallCounters(): void {
  callsPerCase.clear();
}

export function liveCallsUsed(caseId: string): number {
  return callsPerCase.get(caseId) ?? 0;
}

/**
 * The single admission gate for the live path. Every outbound model or platform
 * call must pass through here first — checks are ordered cheapest-and-safest
 * first so a disabled deployment never even resolves a step.
 */
export function admitLiveRequest(
  config: FleetScopeConfig,
  caseId: string,
  stepId: string,
): LiveAdmission {
  if (!config.liveMode) {
    return { admitted: false, rejection: { reason: 'live_mode_disabled' } };
  }

  const step = findLiveStep(caseId, stepId);
  if (step === null) {
    return { admitted: false, rejection: { reason: 'step_not_allowlisted' } };
  }

  const used = liveCallsUsed(caseId);
  if (used >= config.gemini.maxCallsPerCase) {
    return {
      admitted: false,
      rejection: { reason: 'call_budget_exhausted', limit: config.gemini.maxCallsPerCase },
    };
  }

  // Belt and braces: throws if any future refactor reorders the checks above.
  assertLiveModeEnabled(config, `live.${stepId}`);
  callsPerCase.set(caseId, used + 1);
  return { admitted: true, step };
}
