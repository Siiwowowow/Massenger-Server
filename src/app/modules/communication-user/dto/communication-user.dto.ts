import { z } from 'zod';

export const syncCommunicationUserSchema = z.object({
  externalId: z.string().min(1, 'externalId is required').max(255),
  name: z.string().min(1, 'name is required').max(150),
  email: z.string().email('Invalid email address').optional().nullable(),
  avatar: z.string().url('Invalid avatar URL').optional().nullable(),
});

export type SyncCommunicationUserDto = z.infer<typeof syncCommunicationUserSchema>;

export const queryCommunicationUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

export type QueryCommunicationUsersDto = z.infer<typeof queryCommunicationUsersSchema>;
