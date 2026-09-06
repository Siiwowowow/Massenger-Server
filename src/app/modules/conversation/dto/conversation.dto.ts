import { z } from 'zod';
import { ParticipantRole } from '../../../../generated/prisma';

export const createDirectConversationSchema = z.object({
  participantId: z.string().min(1, 'participantId is required'),
});
export type CreateDirectConversationDto = z.infer<
  typeof createDirectConversationSchema
>;

export const createGroupConversationSchema = z.object({
  title: z
    .string()
    .min(2, 'Title must be at least 2 characters')
    .max(100, 'Title cannot exceed 100 characters'),
  participantIds: z
    .array(z.string().min(1, 'participantId cannot be empty'))
    .min(1, 'At least one participant must be provided')
    .max(100, 'Cannot exceed 100 participants'),
  avatar: z.string().url('Invalid avatar URL').optional().nullable(),
});
export type CreateGroupConversationDto = z.infer<
  typeof createGroupConversationSchema
>;

export const addParticipantSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  role: z.nativeEnum(ParticipantRole).optional(),
});
export type AddParticipantDto = z.infer<typeof addParticipantSchema>;

export const queryConversationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});
export type QueryConversationsDto = z.infer<typeof queryConversationsSchema>;
