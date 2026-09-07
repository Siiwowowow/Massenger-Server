import process from 'node:process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';

let cachedServer: any = null;

// Neutralize Express 4 deprecation getter on the application prototype if Express 4 is resolved
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  if (express && express.application) {
    const desc = Object.getOwnPropertyDescriptor(express.application, 'router');
    if (!desc || desc.configurable) {
      Object.defineProperty(express.application, 'router', {
        get() {
          return this._router;
        },
        set(val: any) {
          this._router = val;
        },
        configurable: true,
      });
    }
  }
} catch {
  // Ignore
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const server = app.getHttpAdapter().getInstance();

  // Neutralize Express 4 deprecation getter that conflicts with NestJS 11
  if (server) {
    Object.defineProperty(server, 'router', {
      get() {
        return (this as any)._router;
      },
      set(val: any) {
        (this as any)._router = val;
      },
      configurable: true,
    });
  }

  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  // Security headers with Apollo Sandbox compatibility
  const helmetFn = (helmet as any).default || helmet;
  app.use(
    helmetFn({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? undefined
          : {
              directives: {
                defaultSrc: [`'self'`],
                styleSrc: [`'self'`, `'unsafe-inline'`, 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
                fontSrc: [`'self'`, 'https://fonts.gstatic.com'],
                imgSrc: [`'self'`, 'data:', 'https://apollo-server-landing-page.cdn.apollographql.com', 'https://res.cloudinary.com'],
                scriptSrc: [`'self'`, `'unsafe-inline'`, 'https://cdn.jsdelivr.net'],
              },
            },
    }),
  );

  // Cookie parser
  const cookieMiddleware = (cookieParser as any).default || cookieParser;
  app.use(cookieMiddleware(process.env.COOKIE_SECRET || 'secret'));

  // CORS configuration
  const corsFn = (cors as any).default || cors;
  app.use(
    corsFn({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (
          !origin ||
          corsOrigins.includes(origin) ||
          /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        ) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'x-request-id',
        'x-project-id',
        'x-api-key',
        'x-user-id',
        'x-external-id',
      ],
      exposedHeaders: ['x-request-id', 'x-project-id'],
    }),
  );

  // Global REST API prefix with clean exclusions
  app.setGlobalPrefix(apiPrefix, {
    exclude: ['', '/', 'health', 'graphql'],
  });

  await app.init();
  return server;
}

export default async function handler(req: any, res: any) {
  if (!cachedServer) {
    cachedServer = await bootstrap();
  }
  cachedServer(req, res);
}
