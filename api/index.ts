import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

    // Security: Apply Helmet headers (allow inline styles/scripts for Swagger UI to render properly)
    app.use(
      helmet({
        contentSecurityPolicy: false,
      }),
    );

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

    // Documentation: Swagger API Setup for Vercel Serverless Function
    const config = new DocumentBuilder()
      .setTitle('UnitedUnion eSIM Backend API')
      .setDescription('Production-grade API endpoints for the B2C Travel eSIM storefront.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    
    // Serve Swagger assets from CDN to work flawlessly on Vercel without local static file dependencies
    SwaggerModule.setup('api/docs', app, document, {
      customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.9.0/swagger-ui.min.css',
      customJs: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.9.0/swagger-ui-bundle.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.9.0/swagger-ui-standalone-preset.min.js',
      ],
    });

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
