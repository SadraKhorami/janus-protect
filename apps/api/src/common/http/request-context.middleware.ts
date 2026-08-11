import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import type { JanusRequest } from './janus-request';

export function requestContextMiddleware(logger: Logger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const incoming = request.header('x-request-id');
    const requestId =
      incoming && /^[A-Za-z0-9._-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    const startedAt = performance.now();
    (request as JanusRequest).requestId = requestId;
    response.setHeader('x-request-id', requestId);

    response.on('finish', () => {
      logger.info(
        {
          requestId,
          method: request.method,
          path: request.originalUrl,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'request completed',
      );
    });
    next();
  };
}
