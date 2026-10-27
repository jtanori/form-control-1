import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';

import { createConsoleLogger } from '../logger';

import { createEdgeApp } from './app';
import { loadEdgeConfig } from './config';

export { createEdgeApp, isOriginAllowed, type EdgeOptions } from './app';
export { loadEdgeConfig, EdgeConfigSchema, type EdgeConfig } from './config';
export { issueSession, verifySession, SessionError, bearerToken, SESSION_TTL_MS } from './session';
export { transcribe, SttError, wavDurationMs } from './stt';

const isEntryPoint =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const config = loadEdgeConfig();
  const logger = createConsoleLogger(config.LOG_LEVEL);
  const app = createEdgeApp({ config, logger });
  serve({ fetch: app.fetch, port: config.EDGE_PORT, hostname: '0.0.0.0' }, (info) => {
    logger.info({
      outcome: 'edge_listening',
      port: info.port,
      brainUrl: config.brainUrl,
      configured: config.configured,
      mockStt: config.mockStt,
    });
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      logger.info({ outcome: 'edge_shutdown', signal });
      process.exit(0);
    });
  }
}
