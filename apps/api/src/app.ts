import { Hono } from 'hono';
import { capabilityRoutes } from './routes/capability.js';
import { healthRoutes } from './routes/health.js';
import { liveRoutes } from './routes/live.js';
import { cors } from './middleware/cors.js';
import { requestContext } from './middleware/request-context.js';
import { staticViewer } from './middleware/static-viewer.js';
import { viewerRoutes } from './routes/viewer.js';
import type { EventHub } from './collector/hub.js';
import type { Collector } from './collector/collector.js';
import type { SessionStore } from '@fleetscope/session-store';
import type { GeminiDependencies } from './live/gemini.js';
import type { FleetScopeConfig } from './config/index.js';

/**
 * The local Agent Viewer's three collaborators. Absent in a headless health
 * check and in the tests that only exercise the deferred enterprise routes.
 */
export interface ViewerRuntime {
  readonly store: SessionStore;
  readonly collector: Collector;
  readonly hub: EventHub;
}

/**
 * The FleetScope local service — ONE process, deliberately small.
 *
 * PRIMARY (the local Agent Viewer):
 *   POST /api/ingest · GET /api/health · /api/sessions · /api/sessions/:id ·
 *   /api/sessions/:id/events · the two SSE streams
 *
 * DEFERRED (kept, tested, off the golden path — see docs/archive):
 *   /health · /capability · POST /live/decision. These belong to the earlier
 *   enterprise product direction. They are superseded by real ADK capture and
 *   no MVP surface calls them; they are retained rather than deleted because
 *   they work and are covered.
 */
export function createApp(
  config: FleetScopeConfig,
  logLevel = 'info',
  /**
   * Injected only by tests, so the bounded live path can be exercised without a
   * network, a credential, or a cent of spend.
   */
  liveDependencies?: Partial<GeminiDependencies>,
  viewer?: ViewerRuntime,
): Hono {
  const app = new Hono();

  app.use('*', requestContext(logLevel));
  app.use('*', cors(config));
  if (viewer !== undefined) {
    app.route('/', viewerRoutes(viewer.store, viewer.collector, viewer.hub));
  }
  app.route('/', healthRoutes(config));
  app.route('/', capabilityRoutes(config));
  app.route('/', liveRoutes(config, liveDependencies));

  // Last, so it can never shadow an API route.
  if (config.viewerRoot !== null) app.use('*', staticViewer(config.viewerRoot));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
