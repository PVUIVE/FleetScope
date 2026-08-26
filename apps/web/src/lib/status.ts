/**
 * The one status vocabulary.
 *
 * Every badge in the product resolves through this module, so a Case that is
 * `waiting` reads "Waiting" on the Cases index, in the Workspace header and in
 * the Cockpit — never "waiting" in one place and "Paused" in another.
 *
 * # Three channels, never one
 *
 * A status is carried by a WORD, a GLYPH and a TONE together. Colour alone is
 * not a channel: a viewer with a colour deficiency, a monochrome projector, or a
 * screenshot in a report must still read the state correctly. The tone is the
 * decoration; the word is the fact.
 *
 * # Nothing here invents a state
 *
 * Every input is a value the domain already produced from recorded evidence. A
 * value this module does not recognise resolves to "Unknown" rather than to a
 * plausible-looking default — the same rule `UnknownOr` applies to numbers.
 */

/** How a state should be decorated. Never the only carrier of meaning. */
export type StatusTone = 'ok' | 'warn' | 'deny' | 'info' | 'neutral' | 'unknown';

export interface StatusDescriptor {
  /** The operator-facing word. Title case, product vocabulary. */
  readonly label: string;
  readonly tone: StatusTone;
  /** A shape, so the state survives a monochrome rendering. */
  readonly glyph: string;
  /** One sentence an operator can hover or read out. */
  readonly hint: string;
}

const UNKNOWN: StatusDescriptor = {
  label: 'Unknown',
  tone: 'unknown',
  glyph: '?',
  hint: 'FleetScope has no recorded value for this state.',
};

const table = <T extends string>(
  rows: Readonly<Record<T, StatusDescriptor>>,
): ((value: string | null | undefined) => StatusDescriptor) => {
  const map = rows as Readonly<Record<string, StatusDescriptor>>;
  return (value) => (value === null || value === undefined ? UNKNOWN : (map[value] ?? UNKNOWN));
};

// ── Case ─────────────────────────────────────────────────────────────────────

/**
 * Case state, plus the two derived attention states.
 *
 * `incident` and `needs_attention` are not CaseStates — a Case with an open
 * incident is still `active`. They are computed in `caseAttention` below and
 * shown alongside, because "running" and "running with an open incident" are
 * different situations for the person who has to act.
 */
export const caseStatus = table({
  active: {
    label: 'Running',
    tone: 'info',
    glyph: '▸',
    hint: 'The Runtime is progressing the current milestone.',
  },
  waiting: {
    label: 'Waiting',
    tone: 'warn',
    glyph: '◷',
    hint: 'The Runtime is parked until an external signal arrives.',
  },
  approval_required: {
    label: 'Needs Approval',
    tone: 'warn',
    glyph: '!',
    hint: 'An operator decision is required before the Case can continue.',
  },
  completed: {
    label: 'Completed',
    tone: 'ok',
    glyph: '✓',
    hint: 'The Runtime reported a terminal result.',
  },
  failed: {
    label: 'Failed',
    tone: 'deny',
    glyph: '✗',
    hint: 'The Case ended without completing its objective.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'neutral',
    glyph: '⊘',
    hint: 'The Case was stopped before it completed.',
  },
  incident: {
    label: 'Incident',
    tone: 'deny',
    glyph: '!',
    hint: 'An open incident is recorded against this Case.',
  },
  needs_attention: {
    label: 'Needs Attention',
    tone: 'warn',
    glyph: '!',
    hint: 'Something in this Case is waiting on a person.',
  },
});

// ── Agent instance ───────────────────────────────────────────────────────────

export const agentStatus = table({
  spawned: {
    label: 'Spawned',
    tone: 'neutral',
    glyph: '·',
    hint: 'The agent exists but has not started work.',
  },
  started: {
    label: 'Running',
    tone: 'info',
    glyph: '▸',
    hint: 'The agent is executing.',
  },
  waiting: {
    label: 'Waiting',
    tone: 'warn',
    glyph: '◷',
    hint: 'The agent is parked awaiting a signal.',
  },
  completed: {
    label: 'Completed',
    tone: 'ok',
    glyph: '✓',
    hint: 'The agent finished its work.',
  },
  failed: { label: 'Failed', tone: 'deny', glyph: '✗', hint: 'The agent ended in failure.' },
  cancelled: {
    label: 'Blocked',
    tone: 'neutral',
    glyph: '⊘',
    hint: 'The agent was stopped before finishing.',
  },
});

// ── Control-plane decisions ──────────────────────────────────────────────────

/**
 * Identity, Gateway and Model Armor outcomes.
 *
 * `sanitized` and `flagged` are SUCCESSES with a finding, and are toned as
 * warnings rather than failures. `denied` and `blocked` are policy decisions,
 * not crashes — a rail that renders them as "Tool error" is lying about what the
 * control plane did.
 */
export const controlStatus = table({
  allowed: {
    label: 'Allowed',
    tone: 'ok',
    glyph: '✓',
    hint: 'The control plane authorized this request.',
  },
  routed: {
    label: 'Routed',
    tone: 'ok',
    glyph: '✓',
    hint: 'The Gateway allowed this delegation and routed it.',
  },
  resolved: {
    label: 'Resolved',
    tone: 'ok',
    glyph: '✓',
    hint: 'The Registry resolved the Agent Version.',
  },
  denied: {
    label: 'Denied',
    tone: 'deny',
    glyph: '⊘',
    hint: 'An authorization or routing policy refused the request. Not a crash.',
  },
  blocked: {
    label: 'Blocked',
    tone: 'deny',
    glyph: '✗',
    hint: 'Model Armor refused the content. It reached no context, memory or tool.',
  },
  sanitized: {
    label: 'Sanitized',
    tone: 'warn',
    glyph: '≈',
    hint: 'Content was modified by policy and allowed through. A success with a finding.',
  },
  flagged: {
    label: 'Flagged',
    tone: 'warn',
    glyph: '!',
    hint: 'Content was allowed with a finding recorded. A success with a finding.',
  },
  succeeded: {
    label: 'Succeeded',
    tone: 'ok',
    glyph: '✓',
    hint: 'The action completed as requested.',
  },
  failed: {
    label: 'Failed',
    tone: 'deny',
    glyph: '✗',
    hint: 'Genuine execution failure of the thing that was attempted.',
  },
  pending: {
    label: 'Requested',
    tone: 'info',
    glyph: '…',
    hint: 'Requested, not yet resolved.',
  },
  informational: {
    label: 'Recorded',
    tone: 'neutral',
    glyph: '·',
    hint: 'A recorded fact with no pass/fail character.',
  },
  unavailable: {
    label: 'Unavailable',
    tone: 'unknown',
    glyph: '—',
    hint: 'The boundary exists and nothing behind it does.',
  },
});

// ── Intervention lifecycle ───────────────────────────────────────────────────

/**
 * The eight intervention states, deliberately not collapsible.
 *
 * `requested` is not `acknowledged`, and `acknowledged` is not `succeeded`.
 * Rendering them as one "Done" would claim authoritative Runtime evidence that
 * FleetScope does not have (Invariant 10).
 */
export const interventionStatus = table({
  proposed: {
    label: 'Proposed',
    tone: 'info',
    glyph: '·',
    hint: 'Warden proposed a bounded action. Nothing has been authorized.',
  },
  authorized: {
    label: 'Authorized',
    tone: 'info',
    glyph: '✓',
    hint: 'Policy or an operator authorized the action. It has not been requested yet.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'deny',
    glyph: '⊘',
    hint: 'The action was refused and never requested.',
  },
  requested: {
    label: 'Requested',
    tone: 'info',
    glyph: '→',
    hint: 'FleetScope asked the Runtime to act. The Runtime has not answered.',
  },
  acknowledged: {
    label: 'Acknowledged',
    tone: 'info',
    glyph: '↩',
    hint: 'The Runtime accepted the request. The outcome is still unknown.',
  },
  succeeded: {
    label: 'Succeeded',
    tone: 'ok',
    glyph: '✓',
    hint: 'The Runtime confirmed the intervention took effect.',
  },
  failed: {
    label: 'Failed',
    tone: 'deny',
    glyph: '✗',
    hint: 'The Runtime reported the intervention did not take effect.',
  },
  timed_out: {
    label: 'Timed Out',
    tone: 'warn',
    glyph: '◷',
    hint: 'No authoritative Runtime result arrived. The outcome is unknown, not failed.',
  },
});

// ── Approvals ────────────────────────────────────────────────────────────────

export const approvalStatusBadge = table({
  pending: {
    label: 'Awaiting Decision',
    tone: 'warn',
    glyph: '!',
    hint: 'An operator has not decided yet.',
  },
  approved: {
    label: 'Approved',
    tone: 'ok',
    glyph: '✓',
    hint: 'An operator authorized exactly this action.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'deny',
    glyph: '⊘',
    hint: 'An operator refused this action.',
  },
  expired: {
    label: 'Expired',
    tone: 'neutral',
    glyph: '◷',
    hint: 'The approval expired before it was used.',
  },
});

// ── Incidents ────────────────────────────────────────────────────────────────

export const incidentStatus = table({
  open: { label: 'Open', tone: 'deny', glyph: '!', hint: 'The incident is unresolved.' },
  updated: {
    label: 'Updated',
    tone: 'warn',
    glyph: '!',
    hint: 'New evidence was added to an open incident.',
  },
  resolved: {
    label: 'Resolved',
    tone: 'ok',
    glyph: '✓',
    hint: 'The incident closed with recorded evidence.',
  },
  escalated: {
    label: 'Escalated',
    tone: 'deny',
    glyph: '↑',
    hint: 'The incident was raised to a person.',
  },
});

export const severityStatus = table({
  info: { label: 'Info', tone: 'neutral', glyph: '·', hint: 'Advisory severity.' },
  warning: { label: 'Warning', tone: 'warn', glyph: '!', hint: 'Warning severity.' },
  critical: { label: 'Critical', tone: 'deny', glyph: '!', hint: 'Critical severity.' },
});

// ── Policy dispositions ──────────────────────────────────────────────────────

export const dispositionStatus = table({
  observe: {
    label: 'Observe only',
    tone: 'neutral',
    glyph: '·',
    hint: 'Policy recorded the finding and authorized nothing.',
  },
  recommend: {
    label: 'Recommend',
    tone: 'info',
    glyph: '·',
    hint: 'Policy suggested an action without authorizing it.',
  },
  approval_required: {
    label: 'Approval required',
    tone: 'warn',
    glyph: '!',
    hint: 'Policy requires an operator decision before anything happens.',
  },
  auto_act: {
    label: 'Auto-act',
    tone: 'info',
    glyph: '▸',
    hint: 'Policy authorized one bounded action without a person.',
  },
});

// ── Execution mode ───────────────────────────────────────────────────────────

export type ExecutionModeKey =
  | 'recorded'
  | 'live'
  | 'synthetic'
  | 'simulated'
  | 'historical'
  | 'unavailable'
  | 'recorded_fallback';

export interface ModeDescriptor {
  readonly label: string;
  readonly note: string;
  readonly tone: StatusTone;
}

/**
 * How the evidence on a surface was produced.
 *
 * A synthetic decision must never read as a live platform response, and a
 * recorded fallback must never read as a live proof. These are the exact words
 * the product uses for that distinction, in one place.
 */
export const MODE_COPY: Readonly<Record<ExecutionModeKey, ModeDescriptor>> = {
  recorded: {
    label: 'Recorded Case',
    note: 'deterministic bundled evidence',
    tone: 'neutral',
  },
  live: { label: 'Live Proof', note: 'one bounded backend call', tone: 'info' },
  synthetic: {
    label: 'Synthetic System',
    note: 'local data, real policy path',
    tone: 'neutral',
  },
  simulated: {
    label: 'Simulated Time',
    note: 'a separate invocation, not elapsed time',
    tone: 'neutral',
  },
  historical: {
    label: 'Historical',
    note: 'recorded evidence, nothing is executing',
    tone: 'warn',
  },
  unavailable: {
    label: 'Unavailable',
    note: 'the boundary exists and nothing behind it does',
    tone: 'unknown',
  },
  recorded_fallback: {
    label: 'Recorded fallback',
    note: 'the live path was unavailable',
    tone: 'warn',
  },
};

// ── Derived Case attention ───────────────────────────────────────────────────

export interface CaseAttention {
  /** The primary status badge for the Case. */
  readonly primary: StatusDescriptor;
  /** Extra badges: an open incident, a pending approval. May be empty. */
  readonly flags: readonly StatusDescriptor[];
  /**
   * Sort weight for an operator's queue. Higher demands attention sooner.
   * Derived only from recorded state — never from a clock or a guess.
   */
  readonly priority: number;
}

export interface CaseAttentionInput {
  readonly caseState: string | null | undefined;
  readonly openIncidents: number;
  readonly pendingApprovals: number;
}

/**
 * What an operator should look at first.
 *
 * Ordering is by who is blocked, not by severity in the abstract: a Case waiting
 * on a person outranks a Case that is merely running, because only one of them
 * stops if nobody looks at it.
 */
export function caseAttention(input: CaseAttentionInput): CaseAttention {
  const flags: StatusDescriptor[] = [];
  if (input.pendingApprovals > 0) flags.push(caseStatus('approval_required'));
  if (input.openIncidents > 0) flags.push(caseStatus('incident'));

  const primary = caseStatus(input.caseState);
  const priority =
    (input.pendingApprovals > 0 ? 400 : 0) +
    (input.openIncidents > 0 ? 300 : 0) +
    (input.caseState === 'failed' ? 250 : 0) +
    (input.caseState === 'waiting' ? 100 : 0) +
    (input.caseState === 'active' ? 50 : 0);

  return { primary, flags, priority };
}
