import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { REALTIME_ROOMS } from '../realtime/realtime.constants';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '../../common/exceptions/domain.exceptions';
import { CreateMessageRequestDto } from './dto/message-request.dto';
import { RequestStatus, ConversationType } from '../../../generated/prisma';
import { isValidObjectId } from '../../common/utils/jwt/jwt.util';

@Injectable()
export class MessageRequestService {
  private readonly logger = new Logger(MessageRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    @Optional() private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  /**
   * Helper to broadcast an event to a user's socket room
   */
  private emitToUser(userId: string, event: string, payload: any) {
    if (this.realtimeGateway?.server) {
      try {
        this.realtimeGateway.server
          .to(REALTIME_ROOMS.user(userId))
          .emit(event, payload);
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to emit ${event} to user ${userId}: ${(err as any)?.message}`,
        );
      }
    }
  }

  /**
   * Send a new message request
   */
  async sendRequest(
    projectId: string,
    senderId: string,
    dto: CreateMessageRequestDto,
  ) {
    // 1. Resolve receiver user in this project
    let receiverUser = await this.prisma.communicationUser.findFirst({
      where: {
        projectId,
        OR: [{ id: dto.receiverId }, { externalId: dto.receiverId }],
      },
    });

    // If not found in communicationUser, attempt lazy sync from auth User
    if (!receiverUser) {
      const sysUser = await this.prisma.user.findUnique({
        where: { id: dto.receiverId },
      });

      if (sysUser) {
        receiverUser = await this.prisma.communicationUser.upsert({
          where: {
            projectId_externalId: {
              projectId,
              externalId: sysUser.id,
            },
          },
          create: {
            projectId,
            externalId: sysUser.id,
            name: sysUser.name || 'User',
            email: sysUser.email ? sysUser.email.toLowerCase().trim() : null,
            avatar: sysUser.image || null,
          },
          update: {
            name: sysUser.name || undefined,
            email: sysUser.email ? sysUser.email.toLowerCase().trim() : undefined,
            ...(sysUser.image ? { avatar: sysUser.image } : {}),
          },
        });
      }
    }

    if (!receiverUser) {
      throw new NotFoundException('CommunicationUser', dto.receiverId);
    }

    if (receiverUser.id === senderId) {
      throw new BadRequestException('Cannot send message request to yourself');
    }

    // 2. Check if a direct conversation already exists
    const existingConversation = await this.prisma.conversation.findFirst({
      where: {
        projectId,
        type: ConversationType.DIRECT,
        AND: [
          { participants: { some: { userId: senderId } } },
          { participants: { some: { userId: receiverUser.id } } },
        ],
      },
    });

    if (existingConversation) {
      throw new ConflictException(
        'You already have an active conversation with this user',
      );
    }

    // 3. Check if reverse request exists (receiver already requested sender)
    const reverseRequest = await this.prisma.messageRequest.findUnique({
      where: {
        projectId_senderId_receiverId: {
          projectId,
          senderId: receiverUser.id,
          receiverId: senderId,
        },
      },
    });

    if (reverseRequest && reverseRequest.status === RequestStatus.PENDING) {
      // Auto-accept the reverse request since both want to connect
      return this.acceptRequest(projectId, senderId, reverseRequest.id);
    }

    // 4. Check existing forward request
    const existingRequest = await this.prisma.messageRequest.findUnique({
      where: {
        projectId_senderId_receiverId: {
          projectId,
          senderId,
          receiverId: receiverUser.id,
        },
      },
    });

    let request;
    if (existingRequest) {
      if (existingRequest.status === RequestStatus.PENDING) {
        throw new ConflictException(
          'A message request is already pending for this user',
        );
      }
      if (existingRequest.status === RequestStatus.ACCEPTED) {
        throw new BadRequestException('You are already connected with this user');
      }
      // If REJECTED, allow re-sending: update to PENDING
      request = await this.prisma.messageRequest.update({
        where: { id: existingRequest.id },
        data: {
          status: RequestStatus.PENDING,
          message: dto.message?.trim() || null,
          updatedAt: new Date(),
        },
        include: {
          sender: true,
          receiver: true,
        },
      });
    } else {
      request = await this.prisma.messageRequest.create({
        data: {
          projectId,
          senderId,
          receiverId: receiverUser.id,
          status: RequestStatus.PENDING,
          message: dto.message?.trim() || null,
        },
        include: {
          sender: true,
          receiver: true,
        },
      });
    }

    this.logger.log(
      `Message request created from ${senderId} to ${receiverUser.id} in project ${projectId}`,
    );

    // Notify receiver in real-time
    this.emitToUser(receiverUser.id, 'request:new', request);

    return request;
  }

  /**
   * Get incoming pending requests for the current user
   */
  async getIncoming(projectId: string, userId: string) {
    const data = await this.prisma.messageRequest.findMany({
      where: {
        projectId,
        receiverId: userId,
        status: RequestStatus.PENDING,
      },
      include: {
        sender: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      pendingCount: data.length,
    };
  }

  /**
   * Get outgoing requests sent by the current user
   */
  async getOutgoing(projectId: string, userId: string) {
    const data = await this.prisma.messageRequest.findMany({
      where: {
        projectId,
        senderId: userId,
      },
      include: {
        receiver: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
    };
  }

  /**
   * Accept an incoming message request
   */
  async acceptRequest(projectId: string, userId: string, requestId: string) {
    const request = await this.prisma.messageRequest.findFirst({
      where: {
        id: requestId,
        projectId,
      },
      include: {
        sender: true,
        receiver: true,
      },
    });

    if (!request) {
      throw new NotFoundException('MessageRequest', requestId);
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException(
        'Only the recipient can accept this message request',
      );
    }

    if (request.status === RequestStatus.ACCEPTED) {
      // Already accepted, return existing conversation
      const conversation = await this.conversationService.createDirect(
        projectId,
        request.senderId,
        request.receiverId,
      );
      return { request, conversation };
    }

    // 1. Mark request as ACCEPTED
    const updatedRequest = await this.prisma.messageRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.ACCEPTED,
        updatedAt: new Date(),
      },
      include: {
        sender: true,
        receiver: true,
      },
    });

    // 2. Create DIRECT conversation between sender and receiver
    const conversation = await this.conversationService.createDirect(
      projectId,
      request.senderId,
      request.receiverId,
    );

    this.logger.log(
      `Message request ${requestId} accepted by ${userId}. Direct conversation: ${conversation.id}`,
    );

    // 3. Emit real-time updates to both users
    const payload = { request: updatedRequest, conversation };
    this.emitToUser(request.senderId, 'request:accepted', payload);
    this.emitToUser(request.receiverId, 'request:accepted', payload);

    return payload;
  }

  /**
   * Reject an incoming message request
   */
  async rejectRequest(projectId: string, userId: string, requestId: string) {
    const request = await this.prisma.messageRequest.findFirst({
      where: {
        id: requestId,
        projectId,
      },
    });

    if (!request) {
      throw new NotFoundException('MessageRequest', requestId);
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException(
        'Only the recipient can reject this message request',
      );
    }

    const updated = await this.prisma.messageRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.REJECTED,
        updatedAt: new Date(),
      },
      include: {
        sender: true,
        receiver: true,
      },
    });

    this.logger.log(`Message request ${requestId} rejected by ${userId}`);

    // Notify sender that request was rejected
    this.emitToUser(request.senderId, 'request:rejected', {
      requestId: updated.id,
      request: updated,
    });

    return updated;
  }

  /**
   * Cancel / delete a message request (by sender or recipient)
   * Matches by requestId OR by target user ID for maximum resilience
   */
  async cancelRequest(projectId: string, userId: string, identifier: string) {
    const isObjId = isValidObjectId(identifier);

    const request = await this.prisma.messageRequest.findFirst({
      where: {
        projectId,
        OR: [
          ...(isObjId ? [{ id: identifier }] : []),
          ...(isObjId ? [{ senderId: userId, receiverId: identifier }] : []),
          ...(isObjId ? [{ senderId: identifier, receiverId: userId }] : []),
          {
            senderId: userId,
            receiver: { externalId: identifier },
          },
          {
            receiverId: userId,
            sender: { externalId: identifier },
          },
        ],
      },
    });

    if (!request) {
      // If request is already deleted or not found, return success idempotently
      return {
        message: 'Message request already cancelled or not found',
        requestId: identifier,
      };
    }

    if (request.senderId !== userId && request.receiverId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to cancel this message request',
      );
    }

    await this.prisma.messageRequest.delete({
      where: { id: request.id },
    });

    this.logger.log(`Message request ${request.id} deleted by ${userId}`);

    // Notify both users in real-time
    const payload = { requestId: request.id };
    this.emitToUser(request.senderId, 'request:cancelled', payload);
    this.emitToUser(request.receiverId, 'request:cancelled', payload);

    return {
      message: 'Message request cancelled successfully',
      requestId: request.id,
    };
  }
}
