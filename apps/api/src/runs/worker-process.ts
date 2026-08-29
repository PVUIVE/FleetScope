import { spawn as nodeSpawn } from 'node:child_process';
import { parseAdkIngest, toSourceEvents } from '@fleetscope/adk-adapter';
import { canonicalize } from '@fleetscope/canonicalizer';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { Run } from '@fleetscope/run-ledger';
import type { WorkerPort, WorkerRun } from './orchestrator.js';

/**
 * The Python ADK worker, as an out-of-process WorkerPort.
 *
 * The worker lives in its own runtime with its own pinned `google-adk`, and it
 * is reached the same way an operator reaches it: one process, one versioned
 * JSON request on stdin, one JSON result on stdout. Nothing about ADK crosses
 * this boundary — the events arriving here are already the sanitized wire shape
 * the collector accepts, and they are canonicalized through the SAME adapter as
 * a plugin-reported run, so a worker run and a watched run cannot disagree.
 *
 * Availability is explicit. A local FleetScope with no Python worker configured
 * reports `available: false`, and the orchestrator then reports an incomplete
 * run rather than inventing one.
 */

export interface SpawnedWorker {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injected in tests so no child process, ADK import, or model call happens. */
export type SpawnWorker = (request: string) => Promise<SpawnedWorker>;

export interface ProcessWorkerOptions {
  /** Explicit opt-in. Without it the port is honestly unavailable. */
  readonly enabled: boolean;
  readonly python?: string;
  readonly workerRoot?: string;
  readonly timeoutMs?: number;
  /** Environment for the child process, supplied by the caller. */
  readonly env?: Record<string, string | undefined>;
  readonly spawn?: SpawnWorker;
  readonly newCorrelationId?: () => string;
}

interface WorkerReply {
  readonly state: 'completed' | 'incomplete' | 'failed';
  readonly delegation?: unknown;
  readonly reason?: unknown;
  readonly events?: unknown;
}

const STATES = new Set(['completed', 'incomplete', 'failed']);

function parseReply(stdout: string): WorkerReply | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const reply = parsed as { state?: unknown };
  if (typeof reply.state !== 'string' || !STATES.has(reply.state)) return null;
  return parsed as WorkerReply;
}

/**
 * Convert the worker's wire events into Canonical Events.
 *
 * Reuses `parseAdkIngest` so a malformed or unexpected field is rejected here
 * rather than reaching the evidence spine, and `canonicalize` so ordering, ids
 * and redaction are the product's, not this file's.
 */
export function canonicalizeWorkerEvents(
  sessionId: string,
  events: unknown,
):
  | { readonly ok: true; readonly events: readonly CanonicalEvent[] }
  | { readonly ok: false; readonly reason: string } {
  const ingest = parseAdkIngest({
    framework: 'google-adk',
    sessionId,
    appName: 'fleetscope-adk-worker',
    events,
  });
  if (!ingest.success) return { ok: false, reason: 'worker_events_invalid' };
  const canonical = canonicalize(toSourceEvents(ingest.data, new Set()), sessionId);
  if (canonical.rejected.length > 0) return { ok: false, reason: 'worker_events_rejected' };
  return { ok: true, events: canonical.accepted };
}

function defaultSpawn(options: ProcessWorkerOptions): SpawnWorker {
  const python = options.python ?? 'python3';
  const workerRoot = options.workerRoot ?? 'workers/adk-worker/src';
  const timeoutMs = options.timeoutMs ?? 90_000;
  // The caller supplies the environment; this module reads none of its own.
  const env = { ...(options.env ?? {}), PYTHONPATH: workerRoot };

  return (request) =>
    new Promise<SpawnedWorker>((resolve, reject) => {
      const child = spawnWorkerProcess(python, env, timeoutMs);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin?.end(request);
    });
}

function spawnWorkerProcess(
  python: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
) {
  // `--live` is the worker's own explicit opt-in; the module refuses to touch
  // ADK without it. The timeout is the hard stop the demo budget requires.
  return nodeSpawn(python, ['-m', 'fleetscope_adk_worker', '--live'], {
    env,
    timeout: timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function createProcessWorker(options: ProcessWorkerOptions): WorkerPort {
  const spawn = options.spawn ?? defaultSpawn(options);
  const newCorrelationId = options.newCorrelationId ?? (() => `call-${Date.now().toString(36)}`);

  return {
    available: options.enabled,

    async execute(run: Run): Promise<WorkerRun> {
      const request = JSON.stringify({
        version: 1,
        runId: run.id,
        sessionId: run.id,
        correlationId: newCorrelationId(),
        scenario: run.scenario,
      });

      let spawned: SpawnedWorker;
      try {
        spawned = await spawn(request);
      } catch (error) {
        return {
          state: 'failed',
          delegation: 'unknown',
          events: [],
          reason: (error as Error).name,
        };
      }

      const reply = parseReply(spawned.stdout);
      if (reply === null)
        return {
          state: 'failed',
          delegation: 'unknown',
          events: [],
          reason: 'worker_reply_invalid',
        };

      const rawEvents = Array.isArray(reply.events) ? reply.events : [];
      let events: readonly CanonicalEvent[] = [];
      if (rawEvents.length > 0) {
        const converted = canonicalizeWorkerEvents(run.id, rawEvents);
        if (!converted.ok)
          return { state: 'failed', delegation: 'unknown', events: [], reason: converted.reason };
        events = converted.events;
      }

      // A non-zero exit with a parseable reply is still a failure: the worker's
      // own terminal state is trusted, but the process outcome cannot be ignored.
      const state =
        spawned.code === 0 ? reply.state : reply.state === 'completed' ? 'failed' : reply.state;
      return {
        state,
        delegation: reply.delegation === 'delegated' ? 'delegated' : 'unknown',
        events,
        reason: typeof reply.reason === 'string' ? reply.reason : null,
      };
    },
  };
}
