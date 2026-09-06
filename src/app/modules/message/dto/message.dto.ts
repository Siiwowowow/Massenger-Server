import { z } from 'zod';
import { MessageType } from '../../../../generated/prisma';

export const sendMessageSchema = z.object({
  type: z.nativeEnum(MessageType).optional(),
  content: z
    .string({ required_error: 'Content is required' })
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(5000, 'Message content cannot exceed 5000 characters'),
  metadata: z.record(z.unknown()).optional().nullable(),
  clientMessageId: z.string().optional().nullable(),
});

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const updateMessageSchema = z.object({
  content: z
    .string({ required_error: 'Content is required' })
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(5000, 'Message content cannot exceed 5000 characters'),
});

export type UpdateMessageDto = z.infer<typeof updateMessageSchema>;

export const queryMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number({ invalid_type_error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .positive('Limit must be greater than 0')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
});

export type QueryMessagesDto = z.infer<typeof queryMessagesSchema>;
