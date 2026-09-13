/* eslint-disable */
const process = require('node:process');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');

// Help Vercel's bundler (nft) to trace the ESM packages we dynamically import
// These are never executed, so they avoid the ERR_REQUIRE_ESM crash, but force inclusion.
if (false) {
  require('better-auth');
  require('better-auth/node');
  require('better-auth/adapters/prisma');
  require('better-auth/crypto');
}

let cachedServerPromise = null;

function isOriginAllowed(origin, configuredOrigins) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.vercel.app') || url.hostname === 'vercel.app') {
      return true;
    }
  } catch {
    // Ignore invalid origin URL parse
  }
  return false;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const server = app.getHttpAdapter().getInstance();

  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  const configuredOrigins = [
    ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
    ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : []),
    ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : []),
    'http://localhost:3000',
    'http://localhost:5173',
    'https://massange-fontend.vercel.app',
    'https://massage-backend-rouge.vercel.app',
  ]
    .map((o) => o.trim())
    .filter(Boolean);

  // Security headers with Apollo Sandbox compatibility
  const helmetFn = helmet.default || helmet;
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
  const cookieMiddleware = cookieParser.default || cookieParser;
  app.use(cookieMiddleware(process.env.COOKIE_SECRET || 'secret'));

  // CORS configuration
  const corsFn = cors.default || cors;
  app.use(
    corsFn({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, configuredOrigins)) {
          callback(null, true);
        } else {
          // Do not pass Error to callback, as Express will return 500 error
          callback(null, false);
        }
      },
      credentials: true,
      optionsSuccessStatus: 204,
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

module.exports = async function handler(req, res) {
  if (!cachedServerPromise) {
    cachedServerPromise = bootstrap();
  }
  const server = await cachedServerPromise;
  return server(req, res);
};
