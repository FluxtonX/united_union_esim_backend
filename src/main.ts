/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Security: Enable trust proxy for correct IP parsing behind proxies (Nginx/LB)
  app.set('trust proxy', 1);

  // Security: Apply Helmet headers
  app.use(helmet());

  // Security: CORS configuration
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  // Global Request Logger middleware to see incoming requests in the console
  app.use((req: any, res: any, next: any) => {
    console.log(`[HTTP Request] ${req.method} ${req.url} - IP: ${req.ip}`);
    next();
  });

  // Middleware: Cookie Parser to parse cookie tokens
  app.use(cookieParser());

  // Validation: Global Validation Pipe (whitelist, forbidNonWhitelisted, auto-transform)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Documentation: Swagger API Setup
  const config = new DocumentBuilder()
    .setTitle('UnitedUnion eSIM Backend API')
    .setDescription(
      'Production-grade API endpoints for the B2C Travel eSIM storefront.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(
    `[Bootstrap] UnitedUnion eSIM Backend is running on port: ${port} (listening on all interfaces)`,
  );
  console.log(
    `[Bootstrap] Swagger API Documentation available at: http://localhost:${port}/api/docs`,
  );
}
bootstrap();
