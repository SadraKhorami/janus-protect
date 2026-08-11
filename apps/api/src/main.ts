import 'reflect-metadata';
import { getConfig } from '@janus/config';
import { createLogger } from '@janus/logger';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PinoNestLogger } from './common/logging/pino-nest.logger';
import { HttpExceptionFilter } from './common/http/http-exception.filter';
import { requestContextMiddleware } from './common/http/request-context.middleware';

async function bootstrap(): Promise<void> {
  const config = getConfig();
  const logger = createLogger(config.NODE_ENV);
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger(logger) });

  const expressApplication = app.getHttpAdapter().getInstance() as {
    disable(setting: string): void;
  };
  expressApplication.disable('x-powered-by');
  app.use(cookieParser());
  app.use(requestContextMiddleware(logger));
  app.enableCors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-janus-client', 'x-request-id'],
  });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Janus Protect API')
    .setDescription('Versioned API for Janus Protect platform services.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(config.API_PORT, '0.0.0.0');
  logger.info({ port: config.API_PORT }, 'Janus Protect API started');
}

void bootstrap();
