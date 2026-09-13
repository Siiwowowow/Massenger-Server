import { z } from 'zod';

export const getCallTokenSchema = z.object({
  conversationId: z
    .string()
    .min(1, 'conversationId is required')
    .trim(),
});

export type GetCallTokenDto = z.infer<typeof getCallTokenSchema>;

export const startCallSchema = z.object({
  conversationId: z.string().min(1, 'conversationId is required').trim(),
  callType: z.enum(['AUDIO', 'VIDEO']).default('VIDEO'),
});

export type StartCallDto = z.infer<typeof startCallSchema>;
