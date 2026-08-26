import { Hono } from 'hono';
import { LIVE_STEP_ALLOWLIST } from '../live/allowlist.js';
import type { FleetScopeConfig } from '../config/index.js';

/**
 * Describes what this deployment can actually prove, so the UI never claims a
 * capability the server does not have (Invariant 6, applied to the API itself).
 */
export function capabilityRoutes(config: FleetScopeConfig): Hono {
  const app = new Hono();

  app.get('/capability', (c) =>
    c.json({
      liveMode: config.liveMode,
      // Model name is disclosed only when live mode is actually on; otherwise a
      // configured-but-unused value would read as a capability claim.
      model: config.liveMode ? config.gemini.model : null,
      limits: {
        maxCallsPerCase: config.gemini.maxCallsPerCase,
        maxInputTokens: config.gemini.maxInputTokens,
        maxOutputTokens: config.gemini.maxOutputTokens,
      },
      allowlistedSteps: LIVE_STEP_ALLOWLIST.map((step) => ({
        caseId: step.caseId,
        stepId: step.stepId,
        description: step.description,
        proves: step.proves,
      })),
      note: 'Recorded evidence is the default path and requires none of the above.',
    }),
  );

  return app;
}
