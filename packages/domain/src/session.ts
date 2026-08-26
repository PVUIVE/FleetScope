import type { CaseId, Instant, RuntimeOperationId, SessionId } from './ids.js';

/**
 * One causally related runtime invocation or resumed segment within a Case.
 * Unrelated Cases MUST NOT share a Session sequence.
 */
export const SESSION_STATES = [
  'started',
  'waiting',
  'resumed',
  'completed',
  'failed',
  'controlled',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export interface Session {
  readonly sessionId: SessionId;
  readonly caseId: CaseId;
  readonly runtimeOperationId: RuntimeOperationId;
  readonly state: SessionState;
  readonly startedAt: Instant;
  readonly endedAt?: Instant;
  /** Highest accepted sessionSequence. */
  readonly highWaterMark: number;
}

/** The Runtime control verbs FleetScope is allowed to request. `kill` is not a verb here. */
export const RUNTIME_OPERATIONS = [
  'start',
  'wait',
  'resume',
  'retry',
  'cancel',
  'reroute',
] as const;
export type RuntimeOperation = (typeof RUNTIME_OPERATIONS)[number];
