export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BrainLogger {
  debug: (event: Record<string, unknown>) => void;
  info: (event: Record<string, unknown>) => void;
  warn: (event: Record<string, unknown>) => void;
  error: (event: Record<string, unknown>) => void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured JSON logs. Never pass transcripts or form values in. */
export function createConsoleLogger(level: LogLevel = 'info'): BrainLogger {
  const threshold = LEVELS[level];
  const write = (severity: LogLevel, event: Record<string, unknown>): void => {
    if (LEVELS[severity] < threshold) return;
    const line = JSON.stringify({ severity, at: new Date().toISOString(), ...event });
    if (severity === 'error') console.error(line);
    else if (severity === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (event) => write('debug', event),
    info: (event) => write('info', event),
    warn: (event) => write('warn', event),
    error: (event) => write('error', event),
  };
}

export const silentLogger: BrainLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
