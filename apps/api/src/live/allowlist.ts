/**
 * The live path accepts ONLY these (Case, step) pairs.
 *
 * There is deliberately no free-form prompt endpoint anywhere in this service.
 * A live request names a pre-approved scenario step; the server owns the prompt.
 * This is what keeps the USD 35 ceiling and the injection surface bounded.
 */
export interface LiveStep {
  readonly caseId: string;
  readonly stepId: string;
  readonly description: string;
  /** Which platform capability this step is proving. */
  readonly proves: string;
}

export const LIVE_STEP_ALLOWLIST: readonly LiveStep[] = [
  {
    caseId: 'CASE-1042',
    stepId: 'orchestrator-compliance-decision',
    description: 'Classify the vendor compliance packet against recorded Case context.',
    proves: 'gemini.generate',
  },
  {
    caseId: 'CASE-1042',
    stepId: 'warden-incident-advice',
    description: 'Advise on the repeated logistics tool failure. Advice only; never authority.',
    proves: 'gemini.generate',
  },
];

export function findLiveStep(caseId: string, stepId: string): LiveStep | null {
  return (
    LIVE_STEP_ALLOWLIST.find((step) => step.caseId === caseId && step.stepId === stepId) ?? null
  );
}
