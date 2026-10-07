import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  name: process.env.APP_NAME || 'NestJS-Backend-Server',
  url: process.env.APP_URL || 'http://localhost:5000',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  keepAlive: {
    enabled: process.env.ENABLE_KEEP_ALIVE !== 'false',
    url:
      process.env.KEEP_ALIVE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.APP_URL,
    intervalMinutes: parseInt(process.env.KEEP_ALIVE_INTERVAL_MINUTES || '10', 10),
  },
}));

