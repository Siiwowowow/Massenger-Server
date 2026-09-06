import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '../../common/exceptions/domain.exceptions';
import { isValidObjectId } from '../../common/utils/jwt/jwt.util';
import {
  BulkMarkReadDto,
  MessageReceiptResponseDto,
  UnreadCountResponseDto,
  BulkMarkReadResponseDto,
  ConversationReadStateResponseDto,
} from './dto/receipt.dto';

@Injectable()
export class MessageReceiptService {
  private readonly logger = new Logger(MessageReceiptService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: verify conversation exists in project and requesting user is a member
   */
  async assertConversationMembership(
    projectId: string,
    conversationId: string,
    userId: string,
  ) {
    if (!isValidObjectId(conversationId)) {
      throw new BadRequestException('Invalid conversation ID format');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        projectId,
      },
      include: {
        participants: {
          select: {
            userId: true,
            role: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation', conversationId);
    }

    const isMember = conversation.participants.some((p) => p.userId === userId);
    if (!isMember) {
      throw new ForbiddenException(
        'You are not a member of this conversation',
      );
    }

    return conversation;
  }

  /**
   * Helper: verify message exists in project and return with conversation membership info
   */
  async assertMessageAccess(
    projectId: string,
    messageId: string,
    userId: string,
  ) {
    if (!isValidObjectId(messageId)) {
      throw new BadRequestException('Invalid message ID format');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          select: {
            id: true,
            projectId: true,
            participants: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
    });

    if (!message || message.conversation.projectId !== projectId) {
      throw new NotFoundException('Message', messageId);
    }

    const isMember = message.conversation.participants.some(
      (p) => p.userId === userId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'You are not a member of this conversation',
      );
    }

    return message;
  }

  /**
   * Mark a message as DELIVERED for the recipient
   * Rules:
   * - Message must exist in project
   * - Requester must be a participant of the conversation
   * - Sender cannot create self-receipts
   * - READ cannot regress to DELIVERED
   * - Idempotent
   */
  async markDelivered(
    projectId: string,
    messageId: string,
    userId: string,
  ): Promise<MessageReceiptResponseDto> {
    const message = await this.assertMessageAccess(projectId, messageId, userId);

    if (message.senderId === userId) {
      throw new BadRequestException(
        'Senders cannot create receipts for their own messages',
      );
    }

    const existing = await this.prisma.messageReceipt.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
    });

    if (existing) {
      // If already READ, do not regress to DELIVERED
      if (existing.readAt) {
        return this.formatReceipt(existing);
      }

      // If already DELIVERED, return existing (idempotent, preserve original timestamp)
      if (existing.deliveredAt) {
        return this.formatReceipt(existing, message.conversationId);
      }

      // If record existed without deliveredAt, set it now
      const updated = await this.prisma.messageReceipt.update({
        where: { id: existing.id },
        data: { deliveredAt: new Date() },
      });
      return this.formatReceipt(updated, message.conversationId);
    }

    const created = await this.prisma.messageReceipt.create({
      data: {
        messageId,
        userId,
        projectId,
        deliveredAt: new Date(),
        readAt: null,
      },
    });

    this.logger.log(
      `Message ${messageId} marked DELIVERED for user ${userId}`,
    );
    return this.formatReceipt(created, message.conversationId);
  }

  /**
   * Mark a message as READ for the recipient
   * Rules:
   * - Message must exist in project
   * - Requester must be a participant
   * - Sender cannot create self-receipts
   * - READ automatically satisfies DELIVERED
   * - Idempotent: existing timestamps are preserved (monotonic)
   * - Updates participant conversation read pointer
   */
  async markRead(
    projectId: string,
    messageId: string,
    userId: string,
  ): Promise<MessageReceiptResponseDto> {
    const message = await this.assertMessageAccess(projectId, messageId, userId);

    if (message.senderId === userId) {
      throw new BadRequestException(
        'Senders cannot create receipts for their own messages',
      );
    }

    const now = new Date();

    const existing = await this.prisma.messageReceipt.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
    });

    let receipt: any;

    if (existing) {
      if (existing.readAt) {
        // Already READ: preserve timestamp (idempotent)
        receipt = existing;
      } else {
        // Transition from DELIVERED (or unacknowledged) to READ.
        // If deliveredAt was already recorded earlier, preserve that earlier deliveredAt.
        // Otherwise READ satisfies DELIVERED at `now`.
        const deliveredAt = existing.deliveredAt || now;
        receipt = await this.prisma.messageReceipt.update({
          where: { id: existing.id },
          data: {
            deliveredAt,
            readAt: now,
          },
        });
      }
    } else {
      // First receipt creation directly as READ (READ implies DELIVERED)
      receipt = await this.prisma.messageReceipt.create({
        data: {
          messageId,
          userId,
          projectId,
          deliveredAt: now,
          readAt: now,
        },
      });
    }

    // Update conversation participant read pointer
    await this.updateParticipantReadPointer(
      message.conversationId,
      userId,
      message.id,
      receipt.readAt || now,
    );

    this.logger.log(`Message ${messageId} marked READ for user ${userId}`);
    return this.formatReceipt(receipt, message.conversationId);
  }

  /**
   * Bulk mark messages in a conversation as read
   * Rules:
   * - Conversation must exist in project and requester must be a member
   * - If messageId is provided: marks messages up to that message's creation
   * - If no messageId: marks all unread eligible messages
   * - Excludes user's own sent messages
   * - Idempotent
   */
  async markMessagesAsRead(
    projectId: string,
    conversationId: string,
    userId: string,
    dto?: BulkMarkReadDto,
  ): Promise<BulkMarkReadResponseDto> {
    await this.assertConversationMembership(projectId, conversationId, userId);

    let targetMessage: { id: string; createdAt: Date } | null = null;

    if (dto?.messageId) {
      if (!isValidObjectId(dto.messageId)) {
        throw new BadRequestException('Invalid message ID format');
      }

      targetMessage = await this.prisma.message.findFirst({
        where: {
          id: dto.messageId,
          conversationId,
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      if (!targetMessage) {
        throw new NotFoundException(
          'Message',
          dto.messageId,
        );
      }
    }

    // Eligible messages: in conversation, sent by others, unread by user
    const whereClause: any = {
      conversationId,
      senderId: { not: userId },
      receipts: {
        none: {
          userId,
          readAt: { not: null },
        },
      },
    };

    if (targetMessage) {
      whereClause.OR = [
        { createdAt: { lt: targetMessage.createdAt } },
        {
          createdAt: targetMessage.createdAt,
          id: { lte: targetMessage.id },
        },
      ];
    }

    const unreadMessages = await this.prisma.message.findMany({
      where: whereClause,
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (unreadMessages.length === 0) {
      return {
        conversationId,
        markedCount: 0,
        lastReadMessageId: targetMessage?.id || null,
      };
    }

    const now = new Date();
    const unreadIds = unreadMessages.map((m) => m.id);

    // Fetch existing receipts to preserve earlier deliveredAt timestamps if already delivered
    const existingReceipts = await this.prisma.messageReceipt.findMany({
      where: {
        messageId: { in: unreadIds },
        userId,
      },
    });
    const deliveredMap = new Map<string, Date | null>(
      existingReceipts.map((r) => [r.messageId, r.deliveredAt]),
    );

    // Bulk upsert read receipts for all eligible messages
    await Promise.all(
      unreadMessages.map((msg) => {
        const prevDelivered = deliveredMap.get(msg.id);
        const deliveredAt = prevDelivered || now;

        return this.prisma.messageReceipt.upsert({
          where: {
            messageId_userId: {
              messageId: msg.id,
              userId,
            },
          },
          create: {
            messageId: msg.id,
            userId,
            projectId,
            deliveredAt: now,
            readAt: now,
          },
          update: {
            deliveredAt,
            readAt: now,
          },
        });
      }),
    );

    const latestReadMessageId = targetMessage
      ? targetMessage.id
      : unreadMessages[unreadMessages.length - 1].id;

    await this.updateParticipantReadPointer(
      conversationId,
      userId,
      latestReadMessageId,
      now,
    );

    this.logger.log(
      `Bulk marked ${unreadMessages.length} messages as READ in conversation ${conversationId} for user ${userId}`,
    );

    return {
      conversationId,
      markedCount: unreadMessages.length,
      lastReadMessageId: latestReadMessageId,
    };
  }

  /**
   * Get unread message count for a single conversation
   * Rules:
   * - Participant only
   * - Project isolated
   * - Excludes current user's sent messages
   * - Excludes soft-deleted messages
   */
  async getUnreadCount(
    projectId: string,
    conversationId: string,
    userId: string,
  ): Promise<UnreadCountResponseDto> {
    await this.assertConversationMembership(projectId, conversationId, userId);

    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: userId },
        OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
        receipts: {
          none: {
            userId,
            readAt: { not: null },
          },
        },
      },
    });

    return {
      conversationId,
      unreadCount,
    };
  }

  /**
   * Get unread message counts for all user conversations in the project
   * Single batch query avoiding N+1 overhead
   */
  async getUserUnreadCounts(
    projectId: string,
    userId: string,
  ): Promise<UnreadCountResponseDto[]> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        conversation: {
          projectId,
        },
      },
      select: {
        conversationId: true,
      },
    });

    const conversationIds = participants.map((p) => p.conversationId);
    if (conversationIds.length === 0) {
      return [];
    }

    const unreadMessages = await this.prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        senderId: { not: userId },
        OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
        receipts: {
          none: {
            userId,
            readAt: { not: null },
          },
        },
      },
      select: {
        conversationId: true,
      },
    });

    const countMap = new Map<string, number>();
    for (const msg of unreadMessages) {
      countMap.set(
        msg.conversationId,
        (countMap.get(msg.conversationId) || 0) + 1,
      );
    }

    return conversationIds.map((cId) => ({
      conversationId: cId,
      unreadCount: countMap.get(cId) || 0,
    }));
  }

  /**
   * Retrieve all receipts for a message
   * Rules:
   * - Requester must be a participant of the conversation
   * - Project isolated
   */
  async getMessageReceipts(
    projectId: string,
    messageId: string,
    userId: string,
  ): Promise<MessageReceiptResponseDto[]> {
    await this.assertMessageAccess(projectId, messageId, userId);

    const receipts = await this.prisma.messageReceipt.findMany({
      where: {
        messageId,
        projectId,
      },
      select: {
        messageId: true,
        userId: true,
        deliveredAt: true,
        readAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return receipts.map((r) => this.formatReceipt(r));
  }

  /**
   * Retrieve single receipt for a user
   */
  async getMessageReceipt(
    projectId: string,
    messageId: string,
    targetUserId: string,
    requesterId: string,
  ): Promise<MessageReceiptResponseDto> {
    await this.assertMessageAccess(projectId, messageId, requesterId);

    const receipt = await this.prisma.messageReceipt.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId: targetUserId,
        },
      },
    });

    if (!receipt || receipt.projectId !== projectId) {
      throw new NotFoundException(
        'MessageReceipt',
        `${messageId}:${targetUserId}`,
      );
    }

    return this.formatReceipt(receipt);
  }

  /**
   * Retrieve conversation read state
   */
  async getConversationReadState(
    projectId: string,
    conversationId: string,
    userId: string,
  ): Promise<ConversationReadStateResponseDto> {
    await this.assertConversationMembership(projectId, conversationId, userId);

    const [participant, unread] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
      }),
      this.getUnreadCount(projectId, conversationId, userId),
    ]);

    return {
      conversationId,
      userId,
      lastReadAt: participant?.lastReadAt || null,
      lastReadMessageId: participant?.lastReadMessageId || null,
      unreadCount: unread.unreadCount,
    };
  }

  /**
   * Helper to maintain participant read pointer
   */
  private async updateParticipantReadPointer(
    conversationId: string,
    userId: string,
    messageId: string,
    readAt: Date,
  ) {
    try {
      await this.prisma.conversationParticipant.updateMany({
        where: {
          conversationId,
          userId,
        },
        data: {
          lastReadAt: readAt,
          lastReadMessageId: messageId,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to update participant read pointer for ${userId} in ${conversationId}:`,
        err,
      );
    }
  }

  /**
   * Format message receipt response cleanly
   */
  private formatReceipt(receipt: any, conversationId?: string): MessageReceiptResponseDto {
    return {
      messageId: receipt.messageId,
      userId: receipt.userId,
      deliveredAt: receipt.deliveredAt || null,
      readAt: receipt.readAt || null,
      conversationId: conversationId || receipt.conversationId || receipt.message?.conversationId,
    };
  }
}
