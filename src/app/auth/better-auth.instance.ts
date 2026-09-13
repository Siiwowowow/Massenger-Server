

import { PrismaClient } from '../../generated/prisma';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
globalForPrisma.prisma = prisma;

const defaultTrustedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
  'https://massange-fontend.vercel.app',
  'https://massage-backend-rouge.vercel.app',
  'https://*.vercel.app',
];

const envTrustedOrigins = [
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : []),
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : []),
]
  .map((o) => o.trim())
  .filter(Boolean);

const trustedOrigins = Array.from(new Set([...defaultTrustedOrigins, ...envTrustedOrigins]));

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.APP_URL || 'http://localhost:5000');

const hasGoogleAuth =
  Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET);

let _authInstance: any = null;

// Dummy requires to force Vercel's NFT (Node File Trace) to bundle better-auth
// Since better-auth is ESM, we load it dynamically via eval to avoid TS compiling to require(),
// which causes ERR_REQUIRE_ESM. But NFT misses eval(), so we need these static requires in dead code.
if (process.env.VERCEL_NFT_DUMMY) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('better-auth');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('better-auth/adapters/prisma');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('better-auth/crypto');
}

export const getAuth = async () => {
  if (!_authInstance) {
    const { betterAuth } = await eval('import("better-auth")');
    const { prismaAdapter } = await eval('import("better-auth/adapters/prisma")');
    
    _authInstance = betterAuth({
      database: prismaAdapter(prisma, {
        provider: 'mongodb',
      }),
      advanced: {
        generateId: false,
        database: {
          generateId: false,
        },
      },
      emailAndPassword: {
        enabled: true,
        autoSignIn: true,
        minPasswordLength: 6,
      },
      ...(hasGoogleAuth && {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            redirectURI: process.env.GOOGLE_CALLBACK_URL,
          },
        },
      }),
      session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // 1 day
        cookieCache: {
          enabled: true,
          maxAge: 5 * 60, // 5 minutes
        },
      },
      user: {
        additionalFields: {
          role: {
            type: 'string',
            required: false,
            defaultValue: 'USER',
            input: false,
          },
          status: {
            type: 'string',
            required: false,
            defaultValue: 'ACTIVE',
            input: false,
          },
          phoneNumber: {
            type: 'string',
            required: false,
          },
        },
      },
      secret: process.env.BETTER_AUTH_SECRET || '5FIb92Cbf6aXqy1Yjm8lB61zhVbDPwJv',
      baseURL,
      trustedOrigins,
    });
  }
  return _authInstance;
};

// Create a proxy that defers calls to the actual auth instance
export const auth = new Proxy({}, {
  get(target, prop) {
    if (prop === 'api') {
      return new Proxy({}, {
        get(apiTarget, apiProp) {
          return async (...args: any[]) => {
            const instance = await getAuth();
            return instance.api[apiProp](...args);
          };
        }
      });
    }
    return async (...args: any[]) => {
      const instance = await getAuth();
      return instance[prop](...args);
    };
  }
}) as any;

export type Auth = any;
