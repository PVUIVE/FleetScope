import { Hono } from 'hono';
import { admitLiveRequest, liveCallsUsed } from '../live/guard.js';
import type { FleetScopeConfig } from '../config/index.js';

/**
 * The single bounded live-proof endpoint.
 *
 * It accepts an allowlisted (caseId, stepId) pair — never a prompt. When live
 * mode is off it returns 409 with a machine-readable reason so the browser can
 * fall back to recorded evidence without any UI regression.
 *
 * The Gemini call itself is NOT implemented yet: implementing it before the
 * exact platform APIs are confirmed would mean shipping a fabricated
 * integration. See docs/decisions/0003-bounded-live-path.md.
 */
export function liveRoutes(config: FleetScopeConfig): Hono {
  const app = new Hono();

  app.post('/live/decision', async (c) => {
    type LiveRequestBody = { caseId?: unknown; stepId?: unknown };
    const body: LiveRequestBody = await c.req
      .json<LiveRequestBody>()
      .catch((): LiveRequestBody => ({}));
    const caseId = typeof body.caseId === 'string' ? body.caseId : '';
    const stepId = typeof body.stepId === 'string' ? body.stepId : '';

    if (caseId === '' || stepId === '') {
      return c.json({ error: 'caseId and stepId are required' }, 400);
    }

    const admission = admitLiveRequest(config, caseId, stepId);

    if (!admission.admitted) {
      const status = admission.rejection.reason === 'step_not_allowlisted' ? 403 : 409;
      return c.json(
        {
          error: admission.rejection.reason,
          liveMode: config.liveMode,
          fallback: 'recorded',
          message:
            'Live proof unavailable. The client must render recorded evidence for this step.',
        },
        status,
      );
    }

    return c.json(
      {
        error: 'not_implemented',
        step: admission.step,
        callsUsed: liveCallsUsed(caseId),
        message:
          'The live Gemini/platform call is not implemented. FleetScope does not return a synthetic result labelled as a live platform response.',
      },
      501,
    );
  });

  return app;
}
