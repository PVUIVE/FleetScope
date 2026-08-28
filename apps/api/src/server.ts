import { serve } from '@hono/node-server';
import { SessionStore } from '@fleetscope/session-store';
import { createApp } from './app.js';
import { Collector } from './collector/collector.js';
import { EventHub } from './collector/hub.js';
import { loadConfig } from './config/index.js';

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

const app = createApp(config, config.logLevel, undefined, { store, collector, hub });

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
