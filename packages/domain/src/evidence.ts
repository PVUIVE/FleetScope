import type { EventId, Instant, PolicyVersion } from './ids.js';
import type { ActorRef } from './agent.js';
import type { PlatformDecision } from './platform.js';

/**
 * Decision Evidence is NOT chain-of-thought.
 *
 * It is the set of inspectable recorded facts explaining a decision. `rationale`
 * is a concise operator-safe summary, and it MUST NOT be presented as, or
 * sourced from, private model reasoning.
 */
export interface DecisionEvidence {
  readonly evidenceEventIds: readonly EventId[];
  readonly caseSequence: number;
  readonly actor: ActorRef;
  readonly platformDecision?: PlatformDecision;
  readonly policyVersion?: PolicyVersion;
  readonly rationale?: string;
  /** Set only when a model contributed advice. Advice is never authority. */
  readonly modelReference?: { readonly model: string; readonly responseRef: string };
  readonly authorization?: { readonly source: 'policy' | 'operator'; readonly approver?: string };
  /** The authoritative result, from the owning system — not from request intent. */
  readonly authoritativeResult?: { readonly status: string; readonly at: Instant };
  readonly correlations: Readonly<Record<string, string>>;
}
