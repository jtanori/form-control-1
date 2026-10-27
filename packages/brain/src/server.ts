import { serve } from '@hono/node-server';

import { createApp } from './app';
import { loadConfig } from './config';
import { createConsoleLogger } from './logger';

const config = loadConfig();
const logger = createConsoleLogger(config.LOG_LEVEL);
const app = createApp({ config, logger });

serve({ fetch: app.fetch, port: config.BRAIN_PORT, hostname: '0.0.0.0' }, (info) => {
  logger.info({
    outcome: 'listening',
    port: info.port,
    provider: config.LLM_PROVIDER,
    model: config.LLM_MODEL,
    mock: config.mock,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ outcome: 'shutdown', signal });
    process.exit(0);
  });
}
