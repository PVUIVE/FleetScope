import { serve } from '@hono/node-server';
import { createApp } from '@fleetscope/api/app';
import { createRunDependencies } from '@fleetscope/api/runs';
import { Collector, EventHub, SESSIONS_TOPIC } from '@fleetscope/api/collector';
import { SessionStore } from '@fleetscope/session-store';
import { parseConfig } from '@fleetscope/shared';
import type { LocalConfig } from './config.js';

/**
 * The running local FleetScope: one store, one hub, one HTTP listener.
 *
 * The CLI owns this object and is responsible for stopping it. Everything the
 * process opened — the listener, the SQLite handle, any child the developer
 * asked `fleetscope run` to start — is closed by `stop()`, so a Ctrl-C leaves
 * nothing behind holding the port.
 */
export interface Runtime {
  readonly url: string;
  readonly port: number;
  readonly store: SessionStore;
  readonly hub: EventHub;
  readonly collector: Collector;
  /** Fires whenever the session list changes, with the current list. */
  onSessions(
    listener: (sessions: readonly { id: string; name: string; status: string }[]) => void,
  ): void;
  stop(): Promise<void>;
}

export interface StartOptions {
  readonly local: LocalConfig;
  /** Built static viewer to serve, or null for an API-only collector. */
  readonly viewerRoot: string | null;
  readonly host?: string;
}

export async function startRuntime(options: StartOptions): Promise<Runtime> {
  const host = options.host ?? '127.0.0.1';

  // Reuse the product's own config parser rather than hand-rolling a second
  // one, so the CLI and `pnpm dev:api` cannot disagree about defaults.
  const parsed = parseConfig({
    APP_ENV: 'development',
    PORT: String(options.local.port),
    API_LOG_LEVEL: 'silent',
    FLEETSCOPE_STORAGE: options.local.storage,
    ...(options.viewerRoot === null ? {} : { FLEETSCOPE_VIEWER_ROOT: options.viewerRoot }),
  });
  if (!parsed.ok) throw new Error(`invalid configuration: ${parsed.error.join('; ')}`);

  const store = SessionStore.open(options.local.storage);
  const hub = new EventHub();
  const collector = new Collector(store, hub);
  const runs = createRunDependencies(options.local.storage, { events: collector });
  const app = createApp(parsed.value, 'silent', undefined, { store, collector, hub }, runs);

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const instance = serve({ fetch: app.fetch, port: options.local.port, hostname: host }, () =>
      resolve(instance),
    );
    instance.once('error', reject);
  });

  const url = `http://${host}:${options.local.port}`;

  return {
    url,
    port: options.local.port,
    store,
    hub,
    collector,
    onSessions(listener) {
      hub.subscribe({
        topic: SESSIONS_TOPIC,
        send: (data) => {
          const payload = JSON.parse(data) as {
            sessions: { id: string; name: string; status: string }[];
          };
          listener(payload.sessions);
        },
      });
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
