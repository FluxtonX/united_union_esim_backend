import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';

const server = express();

let cachedApp: NestExpressApplication | null = null;

async function bootstrap() {
  if (!cachedApp) {
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule,
      new ExpressAdapter(server),
      { rawBody: true }
    );

    // Security: Enable trust proxy for correct IP parsing behind proxies (Vercel)
    app.set('trust proxy', 1);

    // Security: Apply Helmet headers
    app.use(helmet());

    // Security: CORS configuration
    app.enableCors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
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

    // Initialize NestJS and register routes with the underlying Express instance
    await app.init();

    cachedApp = app;
  }
  return cachedApp;
}

// Export the serverless function handler
export default async (req: any, res: any) => {
  await bootstrap();
  server(req, res);
};
