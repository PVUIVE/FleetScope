import { Hono } from 'hono';
import { capabilityRoutes } from './routes/capability.js';
import { healthRoutes } from './routes/health.js';
import { liveRoutes } from './routes/live.js';
import { cors } from './middleware/cors.js';
import { requestContext } from './middleware/request-context.js';
import type { GeminiDependencies } from './live/gemini.js';
import type { FleetScopeConfig } from './config/index.js';

/**
 * The bounded FleetScope backend — ONE service, deliberately small.
 *
 * Scope, and nothing beyond it:
 *   health · live capability description · one allowlisted live proof
 *
 * It serves no Case data: recorded evidence is bundled with the static frontend
 * so the product works with this service switched off entirely.
 */
export function createApp(
  config: FleetScopeConfig,
  logLevel = 'info',
  /**
   * Injected only by tests, so the bounded live path can be exercised without a
   * network, a credential, or a cent of spend.
   */
  liveDependencies?: Partial<GeminiDependencies>,
): Hono {
  const app = new Hono();

  app.use('*', requestContext(logLevel));
  app.use('*', cors(config));
  app.route('/', healthRoutes(config));
  app.route('/', capabilityRoutes(config));
  app.route('/', liveRoutes(config, liveDependencies));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
