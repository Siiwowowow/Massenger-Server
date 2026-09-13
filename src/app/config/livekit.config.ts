import { registerAs } from '@nestjs/config';

export const livekitConfig = registerAs('livekit', () => {
  const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

  const rawUrl = process.env.LIVEKIT_URL || (isDev ? 'ws://localhost:7880' : '');
  const rawKey = process.env.LIVEKIT_API_KEY || (isDev ? 'devkey' : '');
  const rawSecret = process.env.LIVEKIT_API_SECRET || (isDev ? 'secret' : '');

  return {
    url: rawUrl.trim(),
    apiKey: rawKey.trim(),
    apiSecret: rawSecret.trim(),
  };
});
