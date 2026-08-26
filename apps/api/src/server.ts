import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';

const config = loadConfig();
const app = createApp(config, config.logLevel);

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(
    JSON.stringify({
      message: 'fleetscope-api listening',
      port: info.port,
      appEnv: config.appEnv,
      liveMode: config.liveMode,
    }),
  );
  if (!config.liveMode) {
    console.log('LIVE_MODE=false — recorded-only. No model or platform call can occur.');
  }
});
