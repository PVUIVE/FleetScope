import type { CaseId, EventId, Instant, MemoryRecordId } from './ids.js';
import type { ActorRef } from './agent.js';

/**
 * A provenance-bearing fact. A Memory Record is untrusted DATA — never an
 * executable instruction and never proof of truth.
 */
export interface MemoryRecord {
  readonly memoryRecordId: MemoryRecordId;
  readonly caseId: CaseId;
  /** Tenant/Case scope. Reads outside this scope must be rejected and recorded. */
  readonly scope: string;
  readonly summary: string;
  readonly actor: ActorRef;
  readonly sourceEventId: EventId;
  readonly createdAt: Instant;
  readonly updatedAt?: Instant;
  readonly retrievalReference?: string;
  readonly sensitivity: 'public' | 'internal' | 'confidential';
}
