import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '../../common/exceptions/domain.exceptions';
import { MessageType } from '../../../generated/prisma';
import {
  SendMessageDto,
  UpdateMessageDto,
  QueryMessagesDto,
} from './dto/message.dto';
import { isValidObjectId } from '../../common/utils/jwt/jwt.util';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reusable check: verify that a conversation exists in the project and the user is a participant
   */
  async assertConversationAccess(
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
   * Reusable check: verify message ownership within project boundaries
   */
  async assertMessageOwner(
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
          },
        },
      },
    });

    if (!message || message.conversation.projectId !== projectId) {
      throw new NotFoundException('Message', messageId);
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException(
        'Only the message sender can modify this message',
      );
    }

    return message;
  }

  /**
   * Send a new message to a conversation
   */
  async sendMessage(
    projectId: string,
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ) {
    // 1. Verify conversation access and membership
    await this.assertConversationAccess(projectId, conversationId, senderId);

    // 2. Duplicate message protection / client retry idempotency
    const clientMessageId =
      dto.clientMessageId ||
      (dto.metadata && typeof dto.metadata === 'object'
        ? (dto.metadata as Record<string, any>).clientMessageId
        : undefined);

    if (clientMessageId) {
      const recentMessages = await this.prisma.message.findMany({
        where: {
          conversationId,
          senderId,
        },
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: this.getMessageInclude(),
      });

      const existing = recentMessages.find((msg) => {
        const meta = msg.metadata as Record<string, any> | null;
        return meta?.clientMessageId === clientMessageId;
      });

      if (existing) {
        this.logger.log(
          `Idempotent duplicate message detected for clientMessageId ${clientMessageId}: returning existing message ${existing.id}`,
        );
        return this.formatMessage(existing);
      }
    }

    const metadataPayload =
      clientMessageId && dto.metadata && typeof dto.metadata === 'object'
        ? { ...(dto.metadata as object), clientMessageId }
        : clientMessageId
          ? { clientMessageId }
          : ((dto.metadata as any) ?? undefined);

    // 3. Persist message to database
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        type: dto.type || MessageType.TEXT,
        content: dto.content.trim(),
        metadata: metadataPayload,
      },
      include: this.getMessageInclude(),
    });

    // 4. Touch conversation lastMessageAt and updatedAt
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `Message ${message.id} sent to conversation ${conversationId} by ${senderId}`,
    );

    return this.formatMessage(message);
  }

  /**
   * Fetch conversation message history with cursor-based pagination
   */
  async findMessages(
    projectId: string,
    conversationId: string,
    userId: string,
    query: QueryMessagesDto,
  ) {
    // Verify membership
    await this.assertConversationAccess(projectId, conversationId, userId);

    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    let whereClause: any = {
      conversationId,
    };

    // If cursor provided, paginate backwards from the cursor message
    if (query.cursor) {
      if (!isValidObjectId(query.cursor)) {
        throw new BadRequestException('Invalid cursor format');
      }

      const cursorMsg = await this.prisma.message.findFirst({
        where: {
          id: query.cursor,
          conversationId,
        },
      });

      if (!cursorMsg) {
        throw new BadRequestException(
          'Cursor message not found in this conversation',
        );
      }

      whereClause = {
        conversationId,
        OR: [
          { createdAt: { lt: cursorMsg.createdAt } },
          {
            createdAt: cursorMsg.createdAt,
            id: { lt: cursorMsg.id },
          },
        ],
      };
    }

    // Query limit + 1 items ordered newest to oldest to determine hasMore
    const rawMessages = await this.prisma.message.findMany({
      where: whereClause,
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: this.getMessageInclude(),
    });

    const hasMore = rawMessages.length > limit;
    const pageItems = hasMore ? rawMessages.slice(0, limit) : rawMessages;

    // The next cursor is the ID of the oldest message in this retrieved page
    const nextCursor =
      hasMore && pageItems.length > 0
        ? pageItems[pageItems.length - 1].id
        : null;

    // Reverse items so the client receives them in chronological order (oldest -> newest)
    const chronologicalMessages = pageItems
      .reverse()
      .map((msg) => this.formatMessage(msg));

    return {
      items: chronologicalMessages,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Get single message by ID
   */
  async findMessageById(
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
        sender: {
          select: {
            id: true,
            externalId: true,
            name: true,
            email: true,
            avatar: true,
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

    return this.formatMessage(message);
  }

  /**
   * Edit message content (Sender only, non-deleted, TEXT only)
   */
  async updateMessage(
    projectId: string,
    messageId: string,
    userId: string,
    dto: UpdateMessageDto,
  ) {
    const message = await this.assertMessageOwner(projectId, messageId, userId);

    if (message.deletedAt) {
      throw new BadRequestException('Deleted messages cannot be edited');
    }

    if (message.type !== MessageType.TEXT) {
      throw new BadRequestException('Only TEXT messages can be edited');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: dto.content.trim(),
        updatedAt: new Date(),
      },
      include: this.getMessageInclude(),
    });

    this.logger.log(`Message ${messageId} edited by sender ${userId}`);
    return this.formatMessage(updated);
  }

  /**
   * Soft delete message (Sender only)
   */
  async deleteMessage(
    projectId: string,
    messageId: string,
    userId: string,
  ) {
    const message = await this.assertMessageOwner(projectId, messageId, userId);

    if (message.deletedAt) {
      return {
        message: 'Message was already deleted',
        data: {
          messageId: message.id,
          conversationId: message.conversationId,
          deletedAt: message.deletedAt,
        },
      };
    }

    const deletedAt = new Date();
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt,
      },
    });

    this.logger.log(`Message ${messageId} soft-deleted by sender ${userId}`);
    return {
      message: 'Message deleted successfully',
      data: {
        messageId: message.id,
        conversationId: message.conversationId,
        deletedAt,
      },
    };
  }

  /**
   * Standardized message formatter handling soft-deleted content hiding
   */
  private formatMessage(message: any) {
    const isDeleted = Boolean(message.deletedAt);
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      sender: message.sender,
      type: message.type,
      content: isDeleted ? null : message.content,
      metadata: isDeleted ? null : message.metadata,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      deletedAt: message.deletedAt || null,
    };
  }

  /**
   * Efficient relation include avoiding N+1 and sensitive data leakage
   */
  private getMessageInclude() {
    return {
      sender: {
        select: {
          id: true,
          externalId: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
    };
  }
}
