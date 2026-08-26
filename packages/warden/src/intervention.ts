import type {
  Intervention,
  InterventionId,
  InterventionState,
  RuntimeOperation,
  RuntimeOperationId,
} from '@fleetscope/domain';
import {
  interventionId as toInterventionId,
  isLegalInterventionTransition,
  runtimeOperationId as toRuntimeOperationId,
} from '@fleetscope/domain';
import { canonicalJson, sha256Hex } from '@fleetscope/shared';
import { ACTION_TEMPLATES, type PolicyEvaluation } from './policy.js';

/**
 * The Intervention lifecycle.
 *
 *     proposed → authorized | rejected
 *              → requested
 *              → acknowledged
 *              → succeeded | failed | timed_out
 *
 * # The three facts that are not the same fact
 *
 * `requested` is FleetScope's intent. `acknowledged` is the Runtime saying it
 * received the request. `succeeded` is the Runtime reporting an authoritative
 * result. Collapsing any two of them produces a UI that claims a recovery
 * happened because a button was pressed, which is the specific failure this
 * whole state machine exists to prevent.
 *
 * # Idempotency
 *
 * One Intervention id reaches the Control Adapter at most ONCE. Redelivery of
 * the same id is a no-op that returns the original outcome. A retry is a NEW
 * Intervention with a fresh id linked by `retryOf` — never a re-run of the old
 * one, because "run it again" and "it ran twice" are indistinguishable after the
 * fact if they share an id.
 */

/** The authoritative acknowledgement, from the owning Runtime. */
export interface ControlAck {
  readonly runtimeOperationId: string;
  readonly acknowledgedAt: string;
}

/** The authoritative result, from the owning Runtime. Never inferred. */
export interface ControlResult {
  readonly runtimeOperationId: string;
  readonly outcome: 'applied' | 'failed' | 'timed_out';
  readonly observedAt: string;
  readonly detail?: string;
}

/**
 * The Control Adapter port.
 *
 * The ONLY way FleetScope may ask a Runtime to do anything. It is an interface
 * rather than a call so that the historical-replay path can be proven to reach
 * it zero times: a replay constructs no Warden at all, and the conformance test
 * asserts an adapter handed in is never touched.
 */
export interface ControlAdapter {
  readonly mode: 'recorded' | 'synthetic' | 'live' | 'unavailable';
  request(intervention: Intervention): Promise<ControlAck>;
  observe(runtimeOperationId: string): Promise<ControlResult>;
}

export type InterventionFailure =
  | { readonly reason: 'not_authorized_by_policy'; readonly detail: string }
  | { readonly reason: 'action_not_allowlisted'; readonly detail: string }
  | { readonly reason: 'illegal_transition'; readonly detail: string }
  | { readonly reason: 'already_executed'; readonly detail: string }
  | { readonly reason: 'attempt_budget_exhausted'; readonly detail: string }
  | { readonly reason: 'control_adapter_unavailable'; readonly detail: string };

/**
 * Deterministic Intervention id.
 *
 * Derived from the incident, the action and the attempt number. Attempt 2 of the
 * same action is therefore a DIFFERENT id by construction — the retry rule is
 * enforced by the id scheme, not by remembering to follow it.
 */
export function deriveInterventionId(
  caseId: string,
  incidentId: string,
  actionTemplate: string,
  attempt: number,
): InterventionId {
  const digest = sha256Hex(canonicalJson({ caseId, incidentId, actionTemplate, attempt })).slice(
    0,
    12,
  );
  return toInterventionId(`itv-${digest}`);
}

export interface ProposeInput {
  readonly caseId: string;
  readonly evaluation: PolicyEvaluation;
  readonly target: string;
  readonly attempt: number;
  readonly proposedAt: string;
  /** Set when this is a retry of an earlier, failed Intervention. */
  readonly retryOf?: InterventionId;
}

export type Proposal =
  | { readonly ok: true; readonly intervention: Intervention }
  | { readonly ok: false; readonly failure: InterventionFailure };

/**
 * Propose an Intervention from a policy decision.
 *
 * Refuses when the policy did not authorize one. A proposal that is not backed
 * by a disposition is not a weaker proposal; it is a bug, and creating it would
 * put an unauthorized action into the audit record as if it had been considered.
 */
export function propose(input: ProposeInput): Proposal {
  const { evaluation } = input;

  if (evaluation.disposition !== 'auto_act' && evaluation.disposition !== 'approval_required') {
    return {
      ok: false,
      failure: {
        reason: 'not_authorized_by_policy',
        detail: `policy returned "${evaluation.disposition}", which authorizes no action`,
      },
    };
  }

  const template = evaluation.actionTemplate;
  if (template === undefined || !Object.hasOwn(ACTION_TEMPLATES, template)) {
    return {
      ok: false,
      failure: {
        reason: 'action_not_allowlisted',
        detail: `"${template ?? '<none>'}" is not an allowlisted action template`,
      },
    };
  }

  return {
    ok: true,
    intervention: {
      interventionId: deriveInterventionId(
        input.caseId,
        evaluation.incidentId,
        template,
        input.attempt,
      ),
      caseId: input.caseId as Intervention['caseId'],
      incidentId: evaluation.incidentId,
      policyVersion: evaluation.policyVersion,
      actionTemplate: template,
      operation: ACTION_TEMPLATES[template]!.operation as RuntimeOperation,
      target: input.target,
      state: 'proposed',
      proposedAt: input.proposedAt,
      ...(input.retryOf !== undefined ? { retryOf: input.retryOf } : {}),
    },
  };
}

export type Transition =
  | { readonly ok: true; readonly intervention: Intervention }
  | { readonly ok: false; readonly failure: InterventionFailure };

/**
 * Advance an Intervention.
 *
 * The legal-transition table lives in `@fleetscope/domain` so the projector and
 * the Warden can never disagree about what is legal. An illegal transition is
 * REFUSED and named — never coerced into the nearest legal one, which would hide
 * exactly the bug the state machine exists to surface.
 */
export function transition(
  intervention: Intervention,
  next: InterventionState,
  patch: { readonly runtimeOperationId?: RuntimeOperationId } = {},
): Transition {
  if (!isLegalInterventionTransition(intervention.state, next)) {
    return {
      ok: false,
      failure: {
        reason: 'illegal_transition',
        detail: `${intervention.state} → ${next} is not a legal Intervention transition`,
      },
    };
  }
  return {
    ok: true,
    intervention: {
      ...intervention,
      state: next,
      ...(patch.runtimeOperationId !== undefined
        ? { runtimeOperationId: patch.runtimeOperationId }
        : {}),
    },
  };
}

/**
 * Build the retry of a failed Intervention.
 *
 * A NEW id, linked to the original. Retrying by re-running the original id would
 * make "requested twice" and "requested once" indistinguishable in the record.
 */
export function retryOf(
  original: Intervention,
  evaluation: PolicyEvaluation,
  attempt: number,
  proposedAt: string,
): Proposal {
  if (original.state !== 'failed' && original.state !== 'timed_out') {
    return {
      ok: false,
      failure: {
        reason: 'illegal_transition',
        detail: `only a failed or timed-out Intervention may be retried, not one in "${original.state}"`,
      },
    };
  }
  return propose({
    caseId: original.caseId,
    evaluation,
    target: original.target,
    attempt,
    proposedAt,
    retryOf: original.interventionId,
  });
}

export interface ExecutionOutcome {
  readonly intervention: Intervention;
  readonly ack: ControlAck | null;
  readonly result: ControlResult | null;
  /** True when this call was a redelivery and the adapter was not touched again. */
  readonly deduplicated: boolean;
}

/**
 * The Warden's execution boundary.
 *
 * Holds the record of which Intervention ids have already reached the Control
 * Adapter, so redelivery is a no-op rather than a second real request. It is a
 * class only because that record has to live somewhere with a lifetime; nothing
 * about it is stateful in the domain sense.
 */
export class Warden {
  readonly #adapter: ControlAdapter;
  readonly #executed = new Map<string, ExecutionOutcome>();

  constructor(adapter: ControlAdapter) {
    this.#adapter = adapter;
  }

  /** Interventions that have reached the Control Adapter, in request order. */
  executedInterventionIds(): readonly string[] {
    return [...this.#executed.keys()];
  }

  hasExecuted(interventionId: InterventionId): boolean {
    return this.#executed.has(interventionId);
  }

  /**
   * Request an authorized Intervention, then observe its authoritative result.
   *
   * Never marks success from the request or the acknowledgement. `succeeded`
   * requires the Runtime to have reported `applied`; anything else — including a
   * missing observation — resolves to `failed` or `timed_out`, because absence of
   * evidence is not evidence of success.
   */
  async execute(
    intervention: Intervention,
  ): Promise<
    { ok: true; outcome: ExecutionOutcome } | { ok: false; failure: InterventionFailure }
  > {
    const existing = this.#executed.get(intervention.interventionId);
    if (existing !== undefined) {
      // Idempotent redelivery: the adapter is NOT called again.
      return { ok: true, outcome: { ...existing, deduplicated: true } };
    }

    if (intervention.state !== 'authorized') {
      return {
        ok: false,
        failure: {
          reason: 'not_authorized_by_policy',
          detail: `an Intervention in "${intervention.state}" may not be requested`,
        },
      };
    }
    if (this.#adapter.mode === 'unavailable') {
      return {
        ok: false,
        failure: {
          reason: 'control_adapter_unavailable',
          detail: 'no Control Adapter is available; the Intervention was not requested',
        },
      };
    }

    const requested = transition(intervention, 'requested');
    if (!requested.ok) return requested;

    // Reserve the id BEFORE the adapter call. A crash between the request and
    // the acknowledgement must not permit a second real request on retry — the
    // whole point of at-most-once.
    const reserved: ExecutionOutcome = {
      intervention: requested.intervention,
      ack: null,
      result: null,
      deduplicated: false,
    };
    this.#executed.set(intervention.interventionId, reserved);

    let ack: ControlAck;
    try {
      ack = await this.#adapter.request(requested.intervention);
    } catch (error) {
      const failed = transition(requested.intervention, 'failed');
      const outcome: ExecutionOutcome = {
        intervention: failed.ok ? failed.intervention : requested.intervention,
        ack: null,
        result: {
          runtimeOperationId: '',
          outcome: 'failed',
          observedAt: requested.intervention.proposedAt,
          detail: error instanceof Error ? error.message : 'control adapter rejected the request',
        },
        deduplicated: false,
      };
      this.#executed.set(intervention.interventionId, outcome);
      return { ok: true, outcome };
    }

    const acknowledged = transition(requested.intervention, 'acknowledged', {
      runtimeOperationId: toRuntimeOperationId(ack.runtimeOperationId),
    });
    if (!acknowledged.ok) return acknowledged;

    let result: ControlResult;
    try {
      result = await this.#adapter.observe(ack.runtimeOperationId);
    } catch {
      result = {
        runtimeOperationId: ack.runtimeOperationId,
        outcome: 'timed_out',
        observedAt: ack.acknowledgedAt,
        detail: 'no authoritative Runtime result was observed',
      };
    }

    // The authoritative result decides. Not the request, not the ack.
    const terminal: InterventionState =
      result.outcome === 'applied'
        ? 'succeeded'
        : result.outcome === 'timed_out'
          ? 'timed_out'
          : 'failed';
    const settled = transition(acknowledged.intervention, terminal);

    const outcome: ExecutionOutcome = {
      intervention: settled.ok ? settled.intervention : acknowledged.intervention,
      ack,
      result,
      deduplicated: false,
    };
    this.#executed.set(intervention.interventionId, outcome);
    return { ok: true, outcome };
  }
}
