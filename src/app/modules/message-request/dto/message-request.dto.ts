import { z } from 'zod';
import { isValidObjectId } from '../../../common/utils/jwt/jwt.util';

export const createMessageRequestSchema = z.object({
  receiverId: z
    .string({ required_error: 'Receiver ID is required' })
    .min(1, 'Receiver ID cannot be empty'),
  message: z.string().max(500, 'Message cannot exceed 500 characters').optional(),
});

export type CreateMessageRequestDto = z.infer<typeof createMessageRequestSchema>;

export const queryMessageRequestsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type QueryMessageRequestsDto = z.infer<typeof queryMessageRequestsSchema>;
