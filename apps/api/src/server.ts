import { serve } from '@hono/node-server';
import { SessionStore } from '@fleetscope/session-store';
import { createApp } from './app.js';
import { Collector } from './collector/collector.js';
import { EventHub } from './collector/hub.js';
import { loadConfig } from './config/index.js';
import { createRunDependencies } from './runs/runtime.js';
import { createProcessWorker } from './runs/worker-process.js';

/**
 * The local FleetScope process.
 *
 * One store, one hub, one HTTP server. It is started by `fleetscope watch` and
 * is the only thing a developer runs.
 */
const config = loadConfig();
const store = SessionStore.open(config.storagePath);
const hub = new EventHub();
const collector = new Collector(store, hub);

// The Python ADK worker is opt-in: it runs a real agent and may spend model
// credits, so an unset variable must leave the local server observer-only.
const workerEnabled = process.env['FLEETSCOPE_ADK_WORKER'] === 'enabled';
const runs = createRunDependencies(config.storagePath, {
  events: collector,
  ...(workerEnabled ? { worker: createProcessWorker({ enabled: true, env: process.env }) } : {}),
});
const app = createApp(config, config.logLevel, undefined, { store, collector, hub }, runs);

const server = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(
    JSON.stringify({
      message: 'fleetscope listening',
      port: info.port,
      appEnv: config.appEnv,
      storage: config.storagePath,
      viewer: config.viewerRoot ?? null,
    }),
  );
});

/** Close the store on the way out so the WAL is checkpointed, not abandoned. */
const shutdown = (signal: string): void => {
  console.log(`fleetscope: ${signal} received, shutting down`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
