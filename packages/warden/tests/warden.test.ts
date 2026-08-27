import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { loadCanonicalEvents } from '@fleetscope/fixtures/node';
import { project } from '@fleetscope/projector';
import type { ApprovalBinding, Intervention } from '@fleetscope/domain';
import {
  DEFAULT_DETECTOR_CONFIG,
  DETECTOR_VERSION,
  POLICY_VERSION,
  Warden,
  detectIncidents,
  deriveIncidentId,
  deriveInterventionId,
  evaluate,
  propose,
  rejectionReasonFor,
  retryOf,
  transition,
  type ControlAck,
  type ControlAdapter,
  type ControlResult,
  type DetectedIncident,
  type PolicyEvaluation,
} from '../src/index.js';

const CASE_ID = 'CASE-1042';
const events = loadCanonicalEvents(CASE_ID);
const AT = '2026-09-07T09:10:00.000Z';

let syntheticSequence = 0;
function event(
  type: CanonicalEvent['type'],
  payload: Record<string, unknown> = {},
  correlations: Record<string, string> = {},
): CanonicalEvent {
  const n = syntheticSequence++;
  return {
    eventId: `evt-w${String(n).padStart(3, '0')}`,
    caseId: 'CASE-W',
    caseSequence: n,
    sessionId: 'sess-001',
    sessionSequence: n,
    schemaVersion: '1.0.0',
    type,
    sourceTime: `2026-09-07T10:${String(n % 60).padStart(2, '0')}:00.000Z`,
    acceptedTime: `2026-09-07T10:${String(n % 60).padStart(2, '0')}:00.000Z`,
    actor: { kind: 'agent', id: 'agent-logistics-1' },
    correlations: { caseId: 'CASE-W', ...correlations },
    payloadRedacted: payload,
  };
}

const failure = (tool: string, errorClass: string): CanonicalEvent =>
  event('tool.failed', { tool, errorClass }, { toolCallId: `tc-${syntheticSequence}` });

/** A Control Adapter that records every call so a test can assert on zero. */
function recordingAdapter(
  outcome: ControlResult['outcome'] = 'applied',
): ControlAdapter & { readonly requests: string[]; readonly observations: string[] } {
  const requests: string[] = [];
  const observations: string[] = [];
  return {
    mode: 'recorded',
    requests,
    observations,
    async request(intervention: Intervention): Promise<ControlAck> {
      requests.push(intervention.interventionId);
      return { runtimeOperationId: `op-${intervention.interventionId}`, acknowledgedAt: AT };
    },
    async observe(runtimeOperationId: string): Promise<ControlResult> {
      observations.push(runtimeOperationId);
      return { runtimeOperationId, outcome, observedAt: AT };
    },
  };
}

const incidentOf = (found: DetectedIncident[], cls: string): DetectedIncident => {
  const incident = found.find((i) => i.incidentClass === cls);
  expect(incident, `no ${cls} incident was detected`).toBeDefined();
  return incident!;
};

// ── Detector ────────────────────────────────────────────────────────────────

describe('the Incident Detector is deterministic and pure', () => {
  it('produces the same candidates from the same prefix, every time', () => {
    const once = detectIncidents(events);
    const twice = detectIncidents(events);
    expect(twice).toEqual(once);
  });

  it('is unaffected by the arrival order of its input', () => {
    expect(detectIncidents([...events].reverse())).toEqual(detectIncidents(events));
  });

  it('names no forbidden runtime capability in its own source', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/detector.ts', import.meta.url), 'utf8');
    for (const forbidden of ['Date.now', 'Math.random', 'fetch(', 'node:fs', 'ControlAdapter']) {
      expect(source, `the detector references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('derives an incident id from evidence, not from a counter', () => {
    expect(deriveIncidentId('C', 'd', 'sig', 'evt-1')).toBe(
      deriveIncidentId('C', 'd', 'sig', 'evt-1'),
    );
    expect(deriveIncidentId('C', 'd', 'sig', 'evt-1')).not.toBe(
      deriveIncidentId('C', 'd', 'sig', 'evt-2'),
    );
  });
});

describe('repeated tool failure', () => {
  it('fires once the same tool and error class exceed the threshold', () => {
    const found = detectIncidents([
      event('tool.requested', { tool: 'Logistics.leadtime.check' }),
      failure('Logistics.leadtime.check', 'upstream_timeout'),
      failure('Logistics.leadtime.check', 'upstream_timeout'),
      failure('Logistics.leadtime.check', 'upstream_timeout'),
    ]);
    const incident = incidentOf(found, 'repeated_tool_failure');
    expect(incident.severity).toBe('critical');
    expect(incident.detectorVersion).toBe(DETECTOR_VERSION);
    expect(incident.evidenceEventIds).toHaveLength(3);
    expect(incident.suggestedActionClass).toBe('retry_idempotent_read');
  });

  it('does not fire below the threshold', () => {
    const found = detectIncidents([
      failure('Logistics.leadtime.check', 'upstream_timeout'),
      failure('Logistics.leadtime.check', 'upstream_timeout'),
    ]);
    expect(found.filter((i) => i.incidentClass === 'repeated_tool_failure')).toEqual([]);
  });

  it('keeps different error classes apart — they are different problems', () => {
    // One systematic fault deserves one recovery. Three unrelated faults do not
    // deserve a retry aimed at whichever happened last.
    const found = detectIncidents([
      failure('Logistics.leadtime.check', 'upstream_timeout'),
      failure('Logistics.leadtime.check', 'not_found'),
      failure('Logistics.leadtime.check', 'rate_limited'),
    ]);
    expect(found.filter((i) => i.incidentClass === 'repeated_tool_failure')).toEqual([]);
  });

  it('normalizes tool names so casing and padding are one signature', () => {
    const found = detectIncidents([
      failure('Logistics.Leadtime.Check', 'upstream_timeout'),
      failure(' logistics.leadtime.check ', 'upstream_timeout'),
      failure('LOGISTICS.LEADTIME.CHECK', 'upstream_timeout'),
    ]);
    expect(found.filter((i) => i.incidentClass === 'repeated_tool_failure')).toHaveLength(1);
  });

  it('finds the recorded failure in the golden Case', () => {
    const incident = incidentOf(detectIncidents(events), 'repeated_tool_failure');
    expect(incident.caseId).toBe(CASE_ID);
    expect(incident.evidenceEventIds.length).toBeGreaterThanOrEqual(3);
  });
});

describe('no-progress loop', () => {
  it('fires on a repeated action signature with nothing achieved between', () => {
    const found = detectIncidents([
      event('tool.requested', { tool: 'X.check' }, { agentInstanceId: 'a-1' }),
      event('tool.requested', { tool: 'X.check' }, { agentInstanceId: 'a-1' }),
      event('tool.requested', { tool: 'X.check' }, { agentInstanceId: 'a-1' }),
    ]);
    expect(incidentOf(found, 'no_progress_loop').suggestedActionClass).toBe('escalate_to_operator');
  });

  it('does not fire when the Case actually advanced', () => {
    const found = detectIncidents([
      event('tool.requested', { tool: 'X.check' }, { agentInstanceId: 'a-1' }),
      event('tool.succeeded', { tool: 'X.check' }, { agentInstanceId: 'a-1' }),
      event('tool.requested', { tool: 'X.check' }, { agentInstanceId: 'a-1' }),
      event('tool.requested', { tool: 'X.check' }, { agentInstanceId: 'a-1' }),
    ]);
    expect(found.filter((i) => i.incidentClass === 'no_progress_loop')).toEqual([]);
  });
});

describe('usage threshold', () => {
  it('fires once cumulative recorded usage crosses the ceiling', () => {
    const found = detectIncidents(
      [
        event('usage.recorded', { outputTokens: 40_000 }),
        event('usage.recorded', { outputTokens: 20_000 }),
      ],
      DEFAULT_DETECTOR_CONFIG,
    );
    expect(incidentOf(found, 'usage_threshold_breach').signature).toBe('output_tokens');
  });

  it('stays quiet below the ceiling', () => {
    const found = detectIncidents([event('usage.recorded', { outputTokens: 100 })]);
    expect(found.filter((i) => i.incidentClass === 'usage_threshold_breach')).toEqual([]);
  });
});

describe('context drift is advisory only', () => {
  it('is detected but suggests observation, never action', () => {
    const incident = incidentOf(detectIncidents(events), 'context_drift');
    expect(incident.suggestedActionClass).toBe('observe_only');
    expect(incident.confidence).toBeDefined();
  });

  it('can never reach an acting disposition, whatever the context', () => {
    const incident = incidentOf(detectIncidents(events), 'context_drift');
    const decision = evaluate(
      {
        incident,
        authorization: { attemptsUsed: 0, attemptBudget: 3 },
      },
      AT,
    );
    expect(decision.disposition).toBe('observe');
  });
});

// ── Policy ──────────────────────────────────────────────────────────────────

describe('the Policy Engine returns exactly one disposition', () => {
  const failureIncident = (): DetectedIncident =>
    incidentOf(
      detectIncidents([
        failure('Logistics.leadtime.check', 'upstream_timeout'),
        failure('Logistics.leadtime.check', 'upstream_timeout'),
        failure('Logistics.leadtime.check', 'upstream_timeout'),
      ]),
      'repeated_tool_failure',
    );

  it('auto-acts on a bounded idempotent read', () => {
    const decision = evaluate(
      {
        incident: failureIncident(),
        authorization: { attemptsUsed: 0, attemptBudget: 1 },
      },
      AT,
    );
    expect(decision.disposition).toBe('auto_act');
    expect(decision.actionTemplate).toBe('retry_idempotent_read');
    expect(decision.sideEffectClass).toBe('idempotent_read');
    expect(decision.policyVersion).toBe(POLICY_VERSION);
  });

  it('escalates rather than retrying once the attempt budget is spent', () => {
    // A budget exists precisely to stop "the same action, once more".
    const decision = evaluate(
      {
        incident: failureIncident(),
        authorization: { attemptsUsed: 1, attemptBudget: 1 },
      },
      AT,
    );
    expect(decision.disposition).toBe('approval_required');
    expect(decision.rationale).toContain('attempt budget exhausted');
  });

  it('is deterministic for the same input', () => {
    const input = {
      incident: failureIncident(),
      authorization: { attemptsUsed: 0, attemptBudget: 1 },
    };
    expect(evaluate(input, AT)).toEqual(evaluate(input, AT));
  });

  it('elevates an approval-required action only with a full matching binding', () => {
    const incident = failureIncident();
    const binding: ApprovalBinding = {
      caseId: incident.caseId,
      actionTemplate: 'retry_idempotent_read',
      target: 'agent-logistics-1',
      parameters: { retryScope: 'one_tool_call' },
      boundCaseSequence: 17,
      expiresAt: '2026-09-07T10:00:00.000Z',
      decision: 'approved',
      approver: 'operator-7',
    };
    const accepted = evaluate(
      {
        incident,
        authorization: {
          attemptsUsed: 1,
          attemptBudget: 1,
          operatorApproval: binding,
          proposedAction: {
            caseId: incident.caseId,
            actionTemplate: 'retry_idempotent_read',
            target: 'agent-logistics-1',
            parameters: { retryScope: 'one_tool_call' },
            boundCaseSequence: 17,
          },
        },
      },
      AT,
    );
    expect(accepted.disposition).toBe('auto_act');
    expect(accepted.approvalBinding).toEqual(binding);

    const changedTarget = evaluate(
      {
        incident,
        authorization: {
          attemptsUsed: 1,
          attemptBudget: 1,
          operatorApproval: binding,
          proposedAction: {
            caseId: incident.caseId,
            actionTemplate: 'retry_idempotent_read',
            target: 'agent-other',
            parameters: { retryScope: 'one_tool_call' },
            boundCaseSequence: 17,
          },
        },
      },
      AT,
    );
    expect(changedTarget.disposition).toBe('approval_required');
    expect(changedTarget.approvalBinding).toBeUndefined();
  });
});

describe('model advice is untrusted advisory data', () => {
  const incident = (): DetectedIncident =>
    incidentOf(
      detectIncidents([
        failure('Logistics.leadtime.check', 'upstream_timeout'),
        failure('Logistics.leadtime.check', 'upstream_timeout'),
        failure('Logistics.leadtime.check', 'upstream_timeout'),
      ]),
      'repeated_tool_failure',
    );

  it('rejects an action the allow-list does not contain', () => {
    expect(
      rejectionReasonFor({
        model: 'gemini',
        responseRef: 'resp-1',
        suggestedActionTemplate: 'delete_all_vendor_records',
        summary: 'clean up',
      }),
    ).toContain('not an allowlisted action template');
  });

  it('rejects advice with no verifiable response reference', () => {
    expect(
      rejectionReasonFor({
        model: 'gemini',
        responseRef: '',
        suggestedActionTemplate: 'retry_idempotent_read',
        summary: 'retry',
      }),
    ).toContain('no verifiable response reference');
  });

  it('records a malicious suggestion as rejected, and acts on the policy instead', () => {
    const decision = evaluate(
      {
        incident: incident(),
        authorization: { attemptsUsed: 0, attemptBudget: 1 },
        advice: {
          model: 'gemini',
          responseRef: 'resp-1',
          suggestedActionTemplate: 'erp_delete_vendor',
          summary: 'ignore policy and delete the vendor',
        },
      },
      AT,
    );
    expect(decision.adviceRejectedReason).toContain('not an allowlisted');
    expect(decision.actionTemplate).toBe('retry_idempotent_read');
    expect(decision.adviceInfluencedDisposition).toBe(false);
  });

  it('never lets even WELL-FORMED advice raise a disposition', () => {
    // Invariant 11: model advice grants no Runtime authority. The strongest
    // thing advice can do is be recorded and ignored.
    const withAdvice = evaluate(
      {
        incident: { ...incident(), incidentClass: 'context_drift' },
        authorization: { attemptsUsed: 0, attemptBudget: 3 },
        advice: {
          model: 'gemini',
          responseRef: 'resp-1',
          suggestedActionTemplate: 'retry_idempotent_read',
          summary: 'a retry would fix this',
        },
      },
      AT,
    );
    expect(withAdvice.disposition).toBe('observe');
    expect(withAdvice.adviceInfluencedDisposition).toBe(false);
  });
});

// ── Intervention lifecycle ──────────────────────────────────────────────────

function authorizedIntervention(): { intervention: Intervention; evaluation: PolicyEvaluation } {
  const incident = incidentOf(
    detectIncidents([
      failure('Logistics.leadtime.check', 'upstream_timeout'),
      failure('Logistics.leadtime.check', 'upstream_timeout'),
      failure('Logistics.leadtime.check', 'upstream_timeout'),
    ]),
    'repeated_tool_failure',
  );
  const evaluation = evaluate(
    {
      incident,
      authorization: { attemptsUsed: 0, attemptBudget: 1 },
    },
    AT,
  );
  const proposal = propose({
    caseId: 'CASE-W',
    evaluation,
    target: 'agent-logistics-1',
    attempt: 1,
    proposedAt: AT,
  });
  expect(proposal.ok).toBe(true);
  const authorized = transition(
    proposal.ok ? proposal.intervention : ({} as Intervention),
    'authorized',
  );
  expect(authorized.ok).toBe(true);
  return {
    intervention: authorized.ok ? authorized.intervention : ({} as Intervention),
    evaluation,
  };
}

function operatorApprovedIntervention(): Intervention {
  const { intervention } = authorizedIntervention();
  const parameters = { retryScope: 'one_tool_call' };
  const approvalBinding: ApprovalBinding = {
    caseId: intervention.caseId,
    actionTemplate: intervention.actionTemplate,
    target: intervention.target,
    parameters,
    boundCaseSequence: 42,
    expiresAt: '2026-09-07T10:00:00.000Z',
    decision: 'approved',
    approver: 'operator-7',
  };
  return {
    ...intervention,
    parameters,
    boundCaseSequence: 42,
    approvalRequired: true,
    approvalBinding,
  };
}

describe('operator approval binding at the Control Adapter boundary', () => {
  it('executes a fully matched, unexpired operator approval', async () => {
    const adapter = recordingAdapter();
    const result = await new Warden(adapter).execute(operatorApprovedIntervention(), {
      currentCaseSequence: 42,
      executedAt: AT,
    });
    expect(result.ok).toBe(true);
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.observations).toHaveLength(1);
  });

  const mutations: readonly {
    readonly name: string;
    readonly apply: (binding: ApprovalBinding) => ApprovalBinding;
  }[] = [
    {
      name: 'Case',
      apply: (binding) => ({ ...binding, caseId: 'CASE-OTHER' as typeof binding.caseId }),
    },
    {
      name: 'action template',
      apply: (binding) => ({ ...binding, actionTemplate: 'reroute_delegation' }),
    },
    { name: 'target', apply: (binding) => ({ ...binding, target: 'agent-other' }) },
    { name: 'parameters', apply: (binding) => ({ ...binding, parameters: { retryScope: 'all' } }) },
    { name: 'evidence prefix', apply: (binding) => ({ ...binding, boundCaseSequence: 41 }) },
    { name: 'expiry', apply: (binding) => ({ ...binding, expiresAt: AT }) },
    { name: 'malformed expiry', apply: (binding) => ({ ...binding, expiresAt: 'not-a-time' }) },
    { name: 'decision', apply: (binding) => ({ ...binding, decision: 'rejected' }) },
    { name: 'approver', apply: (binding) => ({ ...binding, approver: ' ' }) },
  ];

  for (const mutation of mutations) {
    it(`rejects a changed ${mutation.name} before any Control Adapter call`, async () => {
      const intervention = operatorApprovedIntervention();
      const adapter = recordingAdapter();
      const result = await new Warden(adapter).execute(
        { ...intervention, approvalBinding: mutation.apply(intervention.approvalBinding!) },
        { currentCaseSequence: 42, executedAt: AT },
      );
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.failure.reason).toBe('approval_binding_invalid');
      expect(adapter.requests).toEqual([]);
      expect(adapter.observations).toEqual([]);
    });
  }

  it('rejects an advanced Case cursor and a missing execution context before any adapter call', async () => {
    const intervention = operatorApprovedIntervention();
    const changedEvidenceAdapter = recordingAdapter();
    const changedEvidence = await new Warden(changedEvidenceAdapter).execute(intervention, {
      currentCaseSequence: 43,
      executedAt: AT,
    });
    expect(changedEvidence.ok).toBe(false);
    expect(changedEvidenceAdapter.requests).toEqual([]);
    expect(changedEvidenceAdapter.observations).toEqual([]);

    const missingContextAdapter = recordingAdapter();
    const missingContext = await new Warden(missingContextAdapter).execute(intervention);
    expect(missingContext.ok).toBe(false);
    expect(missingContextAdapter.requests).toEqual([]);
    expect(missingContextAdapter.observations).toEqual([]);

    const missingBindingAdapter = recordingAdapter();
    const { approvalBinding: removedBinding, ...withoutBinding } = intervention;
    expect(removedBinding).toBeDefined();
    const missingBinding = await new Warden(missingBindingAdapter).execute(withoutBinding, {
      currentCaseSequence: 42,
      executedAt: AT,
    });
    expect(missingBinding.ok).toBe(false);
    expect(missingBindingAdapter.requests).toEqual([]);
    expect(missingBindingAdapter.observations).toEqual([]);
  });
});

describe('the lifecycle cannot be short-circuited', () => {
  it('refuses an illegal transition instead of coercing it', () => {
    const { intervention } = authorizedIntervention();
    const skipped = transition(intervention, 'succeeded');
    expect(skipped.ok).toBe(false);
    expect(skipped.ok === false && skipped.failure.reason).toBe('illegal_transition');
  });

  it('refuses to propose an action the policy did not authorize', () => {
    const proposal = propose({
      caseId: 'CASE-W',
      evaluation: {
        incidentId: 'inc-1' as PolicyEvaluation['incidentId'],
        policyVersion: POLICY_VERSION as PolicyEvaluation['policyVersion'],
        disposition: 'observe',
        evaluatedAt: AT,
        rationale: 'advisory only',
        sideEffectClass: 'none',
        adviceInfluencedDisposition: false,
      },
      target: 'agent-1',
      attempt: 1,
      proposedAt: AT,
    });
    expect(proposal.ok).toBe(false);
    expect(proposal.ok === false && proposal.failure.reason).toBe('not_authorized_by_policy');
  });

  it('walks every step: requested, acknowledged, then the Runtime result', async () => {
    const { intervention } = authorizedIntervention();
    const adapter = recordingAdapter('applied');
    const result = await new Warden(adapter).execute(intervention);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.intervention.state).toBe('succeeded');
    // Success came from the Runtime's observation, not from having asked.
    expect(result.outcome.result?.outcome).toBe('applied');
    expect(result.outcome.ack?.runtimeOperationId).toBeDefined();
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.observations).toHaveLength(1);
  });

  it('does not report success when the Runtime reports failure', async () => {
    const { intervention } = authorizedIntervention();
    const result = await new Warden(recordingAdapter('failed')).execute(intervention);
    expect(result.ok && result.outcome.intervention.state).toBe('failed');
  });

  it('reports a timeout as timed_out, never as success or as zero', async () => {
    const { intervention } = authorizedIntervention();
    const result = await new Warden(recordingAdapter('timed_out')).execute(intervention);
    expect(result.ok && result.outcome.intervention.state).toBe('timed_out');
  });

  it('treats an unobservable result as not-succeeded', async () => {
    // Absence of evidence is not evidence of success.
    const adapter: ControlAdapter = {
      mode: 'recorded',
      async request(i) {
        return { runtimeOperationId: `op-${i.interventionId}`, acknowledgedAt: AT };
      },
      async observe(): Promise<ControlResult> {
        throw new Error('the Runtime never reported');
      },
    };
    const { intervention } = authorizedIntervention();
    const result = await new Warden(adapter).execute(intervention);
    expect(result.ok && result.outcome.intervention.state).toBe('timed_out');
  });

  it('refuses to request when no Control Adapter is available', async () => {
    const unavailable: ControlAdapter = {
      mode: 'unavailable',
      async request() {
        throw new Error('must not be called');
      },
      async observe() {
        throw new Error('must not be called');
      },
    };
    const { intervention } = authorizedIntervention();
    const result = await new Warden(unavailable).execute(intervention);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe('control_adapter_unavailable');
  });
});

describe('idempotency', () => {
  it('reaches the Control Adapter at most once for one Intervention id', async () => {
    const { intervention } = authorizedIntervention();
    const adapter = recordingAdapter();
    const warden = new Warden(adapter);

    await warden.execute(intervention);
    const redelivered = await warden.execute(intervention);

    expect(adapter.requests).toHaveLength(1);
    expect(redelivered.ok && redelivered.outcome.deduplicated).toBe(true);
    expect(redelivered.ok && redelivered.outcome.intervention.state).toBe('succeeded');
  });

  it('survives many redeliveries', async () => {
    const { intervention } = authorizedIntervention();
    const adapter = recordingAdapter();
    const warden = new Warden(adapter);
    for (let i = 0; i < 10; i++) await warden.execute(intervention);
    expect(adapter.requests).toHaveLength(1);
  });

  it('reserves the id before calling out, so a failing adapter cannot be re-requested', async () => {
    const adapter: ControlAdapter & { calls: number } = {
      mode: 'recorded',
      calls: 0,
      async request(): Promise<ControlAck> {
        this.calls += 1;
        throw new Error('the control plane rejected it');
      },
      async observe(): Promise<ControlResult> {
        throw new Error('must not be reached');
      },
    };
    const { intervention } = authorizedIntervention();
    const warden = new Warden(adapter);

    const first = await warden.execute(intervention);
    const second = await warden.execute(intervention);

    expect(adapter.calls).toBe(1);
    expect(first.ok && first.outcome.intervention.state).toBe('failed');
    expect(second.ok && second.outcome.deduplicated).toBe(true);
  });
});

describe('retry is a new Intervention, never a re-run', () => {
  it('mints a fresh id and links it to the original', async () => {
    const { intervention, evaluation } = authorizedIntervention();
    const failed = await new Warden(recordingAdapter('failed')).execute(intervention);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;

    const retry = retryOf(failed.outcome.intervention, evaluation, 2, AT);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    expect(retry.intervention.interventionId).not.toBe(intervention.interventionId);
    expect(retry.intervention.retryOf).toBe(intervention.interventionId);
    expect(retry.intervention.state).toBe('proposed');
  });

  it('derives a different id per attempt by construction', () => {
    expect(deriveInterventionId('C', 'inc-1', 'retry_idempotent_read', 1)).not.toBe(
      deriveInterventionId('C', 'inc-1', 'retry_idempotent_read', 2),
    );
  });

  it('refuses to retry an Intervention that has not failed', () => {
    const { intervention, evaluation } = authorizedIntervention();
    const retry = retryOf(intervention, evaluation, 2, AT);
    expect(retry.ok).toBe(false);
  });

  it('lets a retry reach the Control Adapter, because it is a different action', async () => {
    const { intervention, evaluation } = authorizedIntervention();
    const adapter = recordingAdapter('failed');
    const warden = new Warden(adapter);

    const first = await warden.execute(intervention);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const retry = retryOf(first.outcome.intervention, evaluation, 2, AT);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    const authorized = transition(retry.intervention, 'authorized');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    await warden.execute(authorized.intervention);
    expect(adapter.requests).toHaveLength(2);
    expect(new Set(adapter.requests).size).toBe(2);
  });
});

// ── The load-bearing replay guarantee ───────────────────────────────────────

describe('historical replay performs zero control-plane execution', () => {
  it('reconstructs a Case containing an Intervention without touching the adapter', () => {
    // The claim FleetScope makes about replay, made mechanical. Projection is a
    // pure reducer; it has no way to reach a Control Adapter, and this proves the
    // whole recorded Case — Warden lifecycle included — replays without one.
    const adapter = recordingAdapter();
    const warden = new Warden(adapter);

    for (let through = 0; through <= 59; through++) {
      project(events, { throughCaseSequence: through });
    }

    expect(adapter.requests).toEqual([]);
    expect(adapter.observations).toEqual([]);
    expect(warden.executedInterventionIds()).toEqual([]);
  });

  it('still surfaces the Intervention state in the reconstructed evidence', () => {
    // Zero execution must not mean zero visibility: the recorded lifecycle is
    // fully present, it simply is not re-performed.
    const state = project(events).state;
    const intervention = state.interventions[0];

    expect(intervention).toBeDefined();
    expect(intervention!.state).toBe('succeeded');
    expect(intervention!.runtimeOperationId).toBeDefined();
    expect(state.invariantViolations).toEqual([]);
  });

  it('walks the recorded lifecycle through every intermediate state', () => {
    // requested is not acknowledged, and acknowledged is not succeeded. Each is
    // its own recorded fact, visible at its own prefix.
    const observed = [30, 31, 32, 33, 34, 36].map(
      (through) => project(events, { throughCaseSequence: through }).state.interventions[0]?.state,
    );
    expect(observed).toEqual([
      undefined,
      'proposed',
      'authorized',
      'requested',
      'acknowledged',
      'succeeded',
    ]);
  });

  it('never reports succeeded without an acknowledgement before it', () => {
    for (let through = 0; through <= 59; through++) {
      const state = project(events, { throughCaseSequence: through }).state;
      const intervention = state.interventions[0];
      if (intervention?.state !== 'succeeded') continue;
      // An acknowledged Intervention carries the Runtime's own operation handle.
      expect(intervention.runtimeOperationId).toBeDefined();
    }
  });

  it('names no control-plane capability in the projector source', async () => {
    const { readFileSync } = await import('node:fs');
    // Comments are stripped first: the projector's own documentation says what
    // it must never do, and scanning the prose would flag the very statement of
    // the rule. Only executable source is checked.
    const source = readFileSync(new URL('../../projector/src/project.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      'ControlAdapter',
      'fetch(',
      'node:fs',
      'Date.now',
      'Math.random',
      'gemini',
      'Warden',
    ]) {
      expect(source, `the projector references ${forbidden}`).not.toContain(forbidden);
    }
  });
});
