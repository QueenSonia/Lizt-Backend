// IMPORTANT: instrument must be imported before everything else for Sentry to work
import './instrument';

import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AppExceptionsFilter } from './filters/app-exceptions-filter';
import express from 'express';
import { corsOptions } from './utils/options.cors';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService);
  const PORT = +(process.env.PORT ?? configService.get('PORT') ?? 3150);

  // // ===== CORS config =====
  // app.enableCors({
  //   origin: '*', // Allow all origins
  // });

  // =====middlewares start=====
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.enableCors(corsOptions);

  // Enhanced security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AppExceptionsFilter(httpAdapter));
  app.useGlobalInterceptors(app.get(LoggingInterceptor));
  // =====middlewares end=====

  // =====swagger config starts=====
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Panda Homes')
    .setDescription('This service enables users access Panda Homes')
    .setVersion('1.0')
    .build();
  // =====swagger config ends=====

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('documentationView', app, document);

  await app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port:: ${PORT}`);
  });

  return app;
}

void bootstrap();
