export const DEMO_SCENARIO = 'dependency_onboarding' as const;

export type DemoScenario = typeof DEMO_SCENARIO;
export type RunState = 'queued' | 'executing' | 'completed' | 'failed' | 'stopped' | 'incomplete';
export type RunRecordKind = 'run.admitted' | 'run.state';

export interface Run {
  readonly id: string;
  readonly scenario: DemoScenario;
  readonly idempotencyKey: string;
  readonly state: RunState;
  readonly executing: boolean;
  readonly reservedModelCalls: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reason: string | null;
}

export interface RunRecord {
  readonly version: 1;
  readonly kind: RunRecordKind;
  readonly at: string;
  readonly run: Run;
}

const states = new Set<RunState>([
  'queued',
  'executing',
  'completed',
  'failed',
  'stopped',
  'incomplete',
]);
const kinds = new Set<RunRecordKind>(['run.admitted', 'run.state']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isTerminal(state: RunState): boolean {
  return (
    state === 'completed' || state === 'failed' || state === 'stopped' || state === 'incomplete'
  );
}

/** Parse a closed schema: malformed durable history is never silently ignored. */
export function parseRunRecord(value: unknown): RunRecord | null {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    !kinds.has(value.kind as RunRecordKind) ||
    !isTimestamp(value.at) ||
    !isObject(value.run)
  )
    return null;
  const run = value.run;
  if (
    typeof run.id !== 'string' ||
    run.id.length === 0 ||
    run.scenario !== DEMO_SCENARIO ||
    typeof run.idempotencyKey !== 'string' ||
    run.idempotencyKey.length === 0 ||
    !states.has(run.state as RunState) ||
    typeof run.executing !== 'boolean' ||
    !Number.isInteger(run.reservedModelCalls) ||
    (run.reservedModelCalls as number) < 0 ||
    !isTimestamp(run.createdAt) ||
    !isTimestamp(run.updatedAt) ||
    !(typeof run.reason === 'string' || run.reason === null)
  )
    return null;
  return value as unknown as RunRecord;
}
