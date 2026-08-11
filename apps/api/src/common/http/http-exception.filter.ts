import { ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import type { Logger } from 'pino';
import { ApplicationError } from '../errors/application-error';
import type { JanusRequest } from './janus-request';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<JanusRequest>();
    const requestId = request.requestId ?? 'unknown';

    let status: number = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';

    if (exception instanceof ApplicationError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 400 ? 'VALIDATION_ERROR' : `HTTP_${status}`;
      const payload = exception.getResponse();
      message =
        typeof payload === 'string' ? payload : this.extractMessage(payload, exception.message);
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'request failed');
    }

    response.status(status).json({ error: { code, message, requestId } });
  }

  private extractMessage(payload: object, fallback: string): string {
    if ('message' in payload) {
      const value = payload.message;
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
    return fallback;
  }
}
