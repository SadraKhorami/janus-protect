import pino, { type LoggerOptions } from 'pino';

const redactionPaths = [
  'password',
  '*.password',
  'req.headers.authorization',
  'req.headers.cookie',
  'refreshToken',
  '*.refreshToken',
  'code',
  '*.code',
  'token',
  '*.token',
];

export function createLogger(environment: string) {
  const options: LoggerOptions = {
    level: environment === 'production' ? 'info' : 'debug',
    redact: { paths: redactionPaths, censor: '[REDACTED]' },
    base: { service: 'janus-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return pino(options);
}
