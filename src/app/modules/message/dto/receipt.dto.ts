import { z } from 'zod';

/**
 * Validation schema for bulk mark as read
 * Strictly disallows unknown fields and validates MongoDB ObjectId format
 */
export const bulkMarkReadSchema = z
  .object({
    messageId: z
      .string({ invalid_type_error: 'messageId must be a string' })
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid message ID format')
      .optional(),
  })
  .strict();

export type BulkMarkReadDto = z.infer<typeof bulkMarkReadSchema>;

/**
 * Normalized Message Receipt DTO
 */
export interface MessageReceiptResponseDto {
  messageId: string;
  userId: string;
  deliveredAt: Date | null;
  readAt: Date | null;
  conversationId?: string;
}

/**
 * Unread count for a single conversation
 */
export interface UnreadCountResponseDto {
  conversationId: string;
  unreadCount: number;
}

/**
 * Result of bulk mark-as-read operation
 */
export interface BulkMarkReadResponseDto {
  conversationId: string;
  markedCount: number;
  lastReadMessageId: string | null;
}

/**
 * Comprehensive conversation read state
 */
export interface ConversationReadStateResponseDto {
  conversationId: string;
  userId: string;
  lastReadAt: Date | null;
  lastReadMessageId: string | null;
  unreadCount: number;
}
