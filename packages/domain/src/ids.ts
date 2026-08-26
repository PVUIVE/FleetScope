/**
 * Branded identifiers. The brands exist so a SessionId cannot be passed where a
 * CaseId is expected — Case and Session are distinct correlation roots and
 * conflating them is the single most likely modelling error in this product.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CaseId = Brand<string, 'CaseId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type EventId = Brand<string, 'EventId'>;
export type AgentVersionRef = Brand<string, 'AgentVersionRef'>;
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;
export type MemoryRecordId = Brand<string, 'MemoryRecordId'>;
export type RuntimeOperationId = Brand<string, 'RuntimeOperationId'>;
export type IncidentId = Brand<string, 'IncidentId'>;
export type InterventionId = Brand<string, 'InterventionId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type PolicyVersion = Brand<string, 'PolicyVersion'>;
export type ProjectorVersion = Brand<string, 'ProjectorVersion'>;
export type ScreenedInputId = Brand<string, 'ScreenedInputId'>;

export const caseId = (v: string): CaseId => v as CaseId;
export const sessionId = (v: string): SessionId => v as SessionId;
export const eventId = (v: string): EventId => v as EventId;
export const agentVersionRef = (v: string): AgentVersionRef => v as AgentVersionRef;
export const agentInstanceId = (v: string): AgentInstanceId => v as AgentInstanceId;
export const memoryRecordId = (v: string): MemoryRecordId => v as MemoryRecordId;
export const runtimeOperationId = (v: string): RuntimeOperationId => v as RuntimeOperationId;
export const incidentId = (v: string): IncidentId => v as IncidentId;
export const interventionId = (v: string): InterventionId => v as InterventionId;
export const approvalId = (v: string): ApprovalId => v as ApprovalId;
export const policyVersion = (v: string): PolicyVersion => v as PolicyVersion;
export const projectorVersion = (v: string): ProjectorVersion => v as ProjectorVersion;
export const screenedInputId = (v: string): ScreenedInputId => v as ScreenedInputId;

/** ISO-8601 instant, always serialized with an explicit offset. */
export type Instant = string;
