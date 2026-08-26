import { Hono } from 'hono';
import type { FleetScopeConfig } from '../config/index.js';

/**
 * Cloud Run readiness. Deliberately dependency-free: it must answer even when
 * live mode is off and no platform credential exists.
 */
export function healthRoutes(config: FleetScopeConfig): Hono {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      appEnv: config.appEnv,
      liveMode: config.liveMode,
      defaultCaseId: config.defaultCaseId,
    }),
  );

  return app;
}
