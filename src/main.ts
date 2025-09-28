import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AppExceptionsFilter } from './filters/app-exceptions-filter';
import { HttpExceptionFilter } from './filters/exception-filter';
import express from 'express';
import { corsOptions } from './utils/options.cors';

async function bootstrap(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const PORT = +(process.env.PORT ?? configService.get('PORT') ?? 3050);

  // // ===== CORS config =====
  // app.enableCors({
  //   origin: '*', // Allow all origins
  // });

  // =====middlewares start=====
  app.use(
    express.json({
      verify: (req, res, buf, encoding) => {
        const enc: BufferEncoding = (encoding || 'utf8') as BufferEncoding;
        req['rawBody'] = buf.toString(enc);
      },
    }),
  );
  app.enableCors(corsOptions);
  app.use(helmet());
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
