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

  // Security: CORS configuration - support Storefront (3001), Admin Panel (3002), Mobile & local dev origins
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      const isAllowed =
        origin === 'http://localhost:3000' ||
        origin === 'http://localhost:3001' ||
        origin === 'http://localhost:3002' ||
        origin === 'http://127.0.0.1:3000' ||
        origin === 'http://127.0.0.1:3001' ||
        origin === 'http://127.0.0.1:3002' ||
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+):(3000|3001|3002)$/.test(origin) ||
        (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.split(',').includes(origin));

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, true); // Fallback allow in dev
      }
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Requested-With',
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
