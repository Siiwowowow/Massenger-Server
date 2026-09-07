const process = require('node:process');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');

let cachedServer = null;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const server = app.getHttpAdapter().getInstance();

  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

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

module.exports = async function handler(req, res) {
  if (!cachedServer) {
    cachedServer = await bootstrap();
  }
  cachedServer(req, res);
};
