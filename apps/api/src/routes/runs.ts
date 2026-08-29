import { Hono } from 'hono';
import { DEMO_SCENARIO } from '@fleetscope/run-ledger';
import { executeRun } from '../runs/orchestrator.js';
import type { RunDependencies } from '../runs/runtime.js';

function loopback(url: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname);
}
function failure(reason: string, detail: string): { error: string; detail: string } {
  return { error: reason, detail };
}

export function runRoutes(runs: RunDependencies): Hono {
  const app = new Hono();
  app.get('/runs/capability', (c) => {
    const capability = runs.ledger.capability();
    return c.json({ scenario: DEMO_SCENARIO, worker: 'unavailable', ...capability });
  });
  app.get('/runs/active', (c) => {
    const active = runs.ledger.active();
    return active.ok
      ? c.json({ run: active.run })
      : c.json(failure('durability_unavailable', active.reason), 503);
  });
  app.get('/runs/:id', (c) => {
    const found = runs.ledger.get(c.req.param('id'));
    if (!found.ok) return c.json(failure('durability_unavailable', found.reason), 503);
    return found.run === null
      ? c.json(failure('run_not_found', 'No durable run matches this id.'), 404)
      : c.json({ run: found.run });
  });
  app.post('/runs', async (c) => {
    if (!loopback(c.req.url))
      return c.json(
        failure('loopback_required', 'Run admission is available only on localhost.'),
        403,
      );
    const key = c.req.header('Idempotency-Key');
    if (key === undefined)
      return c.json(failure('idempotency_key_required', 'Supply an Idempotency-Key header.'), 400);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      (body as { scenario?: unknown }).scenario !== DEMO_SCENARIO
    )
      return c.json(
        failure('invalid_run_request', `Only {"scenario":"${DEMO_SCENARIO}"} is accepted.`),
        400,
      );
    const admitted = runs.ledger.admit({
      scenario: DEMO_SCENARIO,
      idempotencyKey: key,
      reservedModelCalls: 0,
    });
    if (!admitted.admitted) {
      const status =
        admitted.reason === 'durability_unavailable'
          ? 503
          : admitted.reason === 'invalid_idempotency_key'
            ? 400
            : 409;
      return c.json(failure(admitted.reason, admitted.detail), status);
    }
    // Execution happens only where a worker genuinely exists. Without one the
    // response says so, and the run stays admitted rather than being marked
    // finished by a process that never ran anything.
    const executed = runs.worker.available ? await executeRun(admitted.run, runs) : null;
    const reread = runs.ledger.get(admitted.run.id);
    const current =
      executed !== null && reread.ok && reread.run !== null ? reread.run : admitted.run;

    return c.json(
      {
        run: current,
        idempotent: admitted.idempotent,
        executing: false,
        worker: runs.worker.available ? 'available' : 'unavailable',
        ...(executed === null
          ? {
              message:
                'Run admission is durable. No ADK worker, model, tool, or network call has started.',
            }
          : {
              report: executed,
              message: `The run finished as "${executed.state}"; recovery was "${executed.recovery}".`,
            }),
      },
      admitted.idempotent ? 200 : 201,
    );
  });
  return app;
}
