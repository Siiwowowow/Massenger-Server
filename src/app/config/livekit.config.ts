import { registerAs } from '@nestjs/config';

export const livekitConfig = registerAs('livekit', () => ({
  url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
  apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
  apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
}));
