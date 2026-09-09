import { z } from 'zod';

export const getCallTokenSchema = z.object({
  conversationId: z
    .string()
    .min(1, 'conversationId is required')
    .trim(),
});

export type GetCallTokenDto = z.infer<typeof getCallTokenSchema>;
