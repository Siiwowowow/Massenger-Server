/* eslint-disable no-useless-assignment */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { MessageService } from '../message/message.service';
import { MessageReceiptService } from '../message/message-receipt.service';
import { WsAuthGuard } from './guards/websocket-auth.guard';
import {
  REALTIME_EVENTS,
  REALTIME_ROOMS,
  RealtimeErrorCode,
} from './realtime.constants';
import {
  AuthenticatedSocket,
  RealtimeAckResponse,
  RealtimeErrorAck,
  JoinConversationPayload,
  LeaveConversationPayload,
  SendRealtimeMessagePayload,
  EditRealtimeMessagePayload,
  DeleteRealtimeMessagePayload,
  MarkDeliveredPayload,
  MarkReadPayload,
  BulkConversationReadPayload,
  TypingStartPayload,
  TypingStopPayload,
  CallStartPayload,
  CallAcceptPayload,
  CallRejectPayload,
  CallCancelPayload,
  CallEndPayload,
  CallIncomingPayload,
  CallAcceptedPayload,
  CallRejectedPayload,
  CallCancelledPayload,
  CallEndedPayload,
  CallBusyPayload,
  CallErrorPayload,
} from './realtime.types';
import { CallSignalingService } from '../call/call-signaling.service';
import { CallState } from '../call/call.types';
import {
  AppException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '../../common/exceptions/domain.exceptions';
import { MessageType, Project, ProjectStatus, CommunicationUser } from '../../../generated/prisma';
import {
  sendMessageSchema,
  updateMessageSchema,
} from '../message/dto/message.dto';
import { bulkMarkReadSchema } from '../message/dto/receipt.dto';
import { isValidObjectId } from '../../common/utils/jwt/jwt.util';
import { ZodError } from 'zod';
import { PresenceService } from './presence/presence.service';
import { TypingService } from './typing/typing.service';

@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
      // Dynamic origin reflection allows browsers to accept credentials with Socket.IO
      callback(null, true);
    },
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly messageReceiptService: MessageReceiptService,
    private readonly presenceService: PresenceService,
    private readonly typingService: TypingService,
    private readonly callSignalingService: CallSignalingService,
  ) {}

  /**
   * Register Socket.IO middleware for handshake authentication
   */
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        const { project, communicationUser } =
          await this.authenticateSocket(socket);

        socket.data.project = project;
        socket.data.communicationUser = communicationUser;
        next();
      } catch (err: unknown) {
        const errorAck = this.formatError(err);
        const error = new Error(errorAck.error.message) as any;
        error.data = errorAck;
        next(error);
      }
    });

    // Phase 2: Call ringing timeout notification
    this.callSignalingService.onCallTimeout(async (call) => {
      const caller = await this.prisma.communicationUser.findUnique({
        where: { id: call.callerId },
        select: { name: true },
      });
      const callLabel = call.callType === 'VIDEO' ? 'video' : 'audio';
      const missedCallMessage = await this.messageService.sendMessage(
        call.projectId,
        call.conversationId,
        call.callerId,
        {
          type: MessageType.SYSTEM,
          content: `Missed ${callLabel} call from ${caller?.name || 'a user'}`,
          metadata: {
            event: 'MISSED_CALL',
            callId: call.id,
            callType: call.callType,
          },
        },
      );

      this.server
        .to(REALTIME_ROOMS.conversation(call.conversationId))
        .emit(REALTIME_EVENTS.SERVER.MESSAGE_NEW, missedCallMessage);

      const payload: CallEndedPayload = {
        callId: call.id,
        conversationId: call.conversationId,
        endedBy: 'system',
        reason: 'TIMEOUT',
      };
      this.server
        .to(REALTIME_ROOMS.user(call.callerId))
        .emit(REALTIME_EVENTS.SERVER.CALL_ENDED, payload);
      this.server
        .to(REALTIME_ROOMS.user(call.receiverId))
        .emit(REALTIME_EVENTS.SERVER.CALL_ENDED, payload);
    });
  }

  /**
   * Handle incoming socket connection and join user room
   */
  async handleConnection(client: Socket) {
    const user = client.data?.communicationUser as CommunicationUser | undefined;
    const project = client.data?.project as Project | undefined;

    if (!user || !project) {
      client.disconnect(true);
      return;
    }

    await client.join(REALTIME_ROOMS.user(user.id));
    this.logger.log(
      `Socket connected: ${client.id} | User: ${user.id} (${user.name}) | Project: ${project.id} (${project.slug})`,
    );

    // Phase F: Presence connect tracking
    try {
      const { isTransition, presence } = await this.presenceService.handleConnect(
        project.id,
        user.id,
        client.id,
      );

      if (isTransition) {
        const rooms = await this.presenceService.getUserConversationRooms(
          project.id,
          user.id,
        );
        for (const room of rooms) {
          this.server.to(room).emit(REALTIME_EVENTS.SERVER.PRESENCE_ONLINE, {
            userId: presence.userId,
            isOnline: true,
          });
        }
      }
    } catch (err: unknown) {
      this.logger.error(`Error tracking presence on connect: ${(err as any)?.message}`);
    }
  }

  /**
   * Handle socket disconnection
   */
  async handleDisconnect(client: Socket) {
    const user = client.data?.communicationUser as CommunicationUser | undefined;
    this.logger.log(
      `Socket disconnected: ${client.id}${user ? ` | User: ${user.id}` : ''}`,
    );

    // Phase F: Clean up any active typing state for this socket
    try {
      const stoppedTypingList = this.typingService.cleanupSocket(client.id);
      for (const item of stoppedTypingList) {
        this.server
          .to(REALTIME_ROOMS.conversation(item.conversationId))
          .emit(REALTIME_EVENTS.SERVER.TYPING_STOPPED, {
            conversationId: item.conversationId,
            userId: item.userId,
          });
      }
    } catch (err: unknown) {
      this.logger.error(`Error cleaning up typing on disconnect: ${(err as any)?.message}`);
    }

    // Phase F: Presence disconnect tracking
    try {
      const result = await this.presenceService.handleDisconnect(client.id);
      if (result && result.isTransition) {
        const rooms = await this.presenceService.getUserConversationRooms(
          result.projectId,
          result.userId,
        );
        for (const room of rooms) {
          this.server.to(room).emit(REALTIME_EVENTS.SERVER.PRESENCE_OFFLINE, {
            userId: result.presence.userId,
            isOnline: false,
            lastSeenAt: result.presence.lastSeenAt,
          });
        }
      }
    } catch (err: unknown) {
      this.logger.error(`Error tracking presence on disconnect: ${(err as any)?.message}`);
    }
  }

  /**
   * Authenticate handshake credentials matching REST authentication semantics
   */
  private async authenticateSocket(
    client: Socket,
  ): Promise<{ project: Project; communicationUser: CommunicationUser }> {
    const handshake = client.handshake;
    const auth = handshake.auth || {};
    const headers = handshake.headers || {};
    const query = (handshake.query || {}) as Record<string, string>;

    // 1. Resolve Project context
    const apiKey =
      auth.apiKey ||
      headers['x-api-key'] ||
      query.apiKey ||
      query['x-api-key'];

    const projectId =
      auth.projectId ||
      headers['x-project-id'] ||
      query.projectId ||
      query['x-project-id'];

    if (!projectId && !apiKey) {
      throw new UnauthorizedException(
        'Project context is required. Provide x-project-id, x-api-key header, or auth credentials',
      );
    }

    let project: Project | null = null;
    if (apiKey) {
      project = await this.prisma.project.findUnique({
        where: { apiKey: String(apiKey) },
      });
    } else if (projectId) {
      if (!isValidObjectId(String(projectId))) {
        throw new BadRequestException('Invalid project ID format');
      }
      project = await this.prisma.project.findUnique({
        where: { id: String(projectId) },
      });
    }

    if (!project) {
      throw new UnauthorizedException(
        `Project '${projectId || apiKey || 'unknown'}' not found`,
      );
    }

    if (project.status !== ProjectStatus.ACTIVE) {
      throw new ForbiddenException(
        `Project is currently ${project.status.toLowerCase()}. Access is restricted`,
      );
    }

    // 2. Resolve Communication User identity
    const userId =
      auth.userId ||
      headers['x-user-id'] ||
      query.userId ||
      query['x-user-id'];

    const externalId =
      auth.externalId ||
      headers['x-external-id'] ||
      query.externalId ||
      query['x-external-id'];

    let commUser: CommunicationUser | null = null;

    if (userId) {
      if (!isValidObjectId(String(userId))) {
        throw new BadRequestException('Invalid user ID format');
      }
      commUser = await this.prisma.communicationUser.findFirst({
        where: {
          id: String(userId),
          projectId: project.id,
        },
      });

      if (!commUser) {
        throw new UnauthorizedException(
          `Communication user '${userId}' not found in project '${project.id}'`,
        );
      }
    } else if (externalId) {
      commUser = await this.prisma.communicationUser.findUnique({
        where: {
          projectId_externalId: {
            projectId: project.id,
            externalId: String(externalId).trim(),
          },
        },
      });

      if (!commUser) {
        throw new UnauthorizedException(
          `Communication user with externalId '${externalId}' not found in project '${project.id}'`,
        );
      }
    } else {
      throw new UnauthorizedException(
        'Communication user identity required. Provide userId/externalId in auth, headers, or query',
      );
    }

    return { project, communicationUser: commUser };
  }

  /**
   * Helper to format standardized socket errors
   */
  private formatError(err: unknown): RealtimeErrorAck {
    if (err instanceof AppException) {
      let code = RealtimeErrorCode.INTERNAL_ERROR;
      const errCodeStr = String(err.errorCode);

      if (errCodeStr.includes('UNAUTHENTICATED') || errCodeStr.includes('UNAUTHORIZED')) {
        code = RealtimeErrorCode.UNAUTHORIZED;
      } else if (errCodeStr.includes('FORBIDDEN')) {
        code = RealtimeErrorCode.FORBIDDEN;
      } else if (errCodeStr.includes('NOT_FOUND')) {
        code = RealtimeErrorCode.NOT_FOUND;
      } else if (errCodeStr.includes('VALIDATION')) {
        code = RealtimeErrorCode.VALIDATION_ERROR;
      } else if (errCodeStr.includes('BAD_REQUEST')) {
        code = RealtimeErrorCode.BAD_REQUEST;
      }

      return {
        success: false,
        error: {
          code,
          message: err.message,
        },
      };
    }

    if (err instanceof ZodError) {
      return {
        success: false,
        error: {
          code: RealtimeErrorCode.VALIDATION_ERROR,
          message: err.errors[0]?.message || 'Validation failed',
          details: err.flatten(),
        },
      };
    }

    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred';

    return {
      success: false,
      error: {
        code: RealtimeErrorCode.INTERNAL_ERROR,
        message,
      },
    };
  }

  // =========================================================================
  // 1. CONVERSATION ROOM MANAGEMENT
  // =========================================================================

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN)
  async handleJoinConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: JoinConversationPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;
    this.logger.log(`handleJoinConversation invoked for user ${user?.id} in project ${project?.id}`);

    try {
      if (!payload || !payload.conversationId || !isValidObjectId(payload.conversationId)) {
        throw new BadRequestException('Valid conversationId is required');
      }

      // Verify conversation exists in project and user is a participant
      await this.conversationService.findById(
        project.id,
        payload.conversationId,
        user.id,
      );

      await socket.join(REALTIME_ROOMS.conversation(payload.conversationId));

      const presence = await this.presenceService.getConversationPresence(
        project.id,
        payload.conversationId,
        user.id,
      );

      const response = {
        success: true as const,
        data: {
          conversationId: payload.conversationId,
          presence,
        },
      };

      socket.emit(
        REALTIME_EVENTS.SERVER.CONVERSATION_JOIN_SUCCESS,
        response.data,
      );

      this.logger.log(
        `User ${user.id} joined conversation room: ${payload.conversationId}`,
      );

      return response;
    } catch (err: unknown) {
      this.logger.warn(`Join error for user ${user?.id}: ${(err as any)?.message}`);
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.CONVERSATION_JOIN_ERROR, errorAck);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CONVERSATION_LEAVE)
  async handleLeaveConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: LeaveConversationPayload,
  ): Promise<RealtimeAckResponse> {
    try {
      if (!payload || !payload.conversationId || !isValidObjectId(payload.conversationId)) {
        throw new BadRequestException('Valid conversationId is required');
      }

      await socket.leave(REALTIME_ROOMS.conversation(payload.conversationId));

      const response = {
        success: true as const,
        data: { conversationId: payload.conversationId },
      };

      socket.emit(
        REALTIME_EVENTS.SERVER.CONVERSATION_LEAVE_SUCCESS,
        response.data,
      );

      return response;
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  // =========================================================================
  // 2. REALTIME MESSAGING (SEND, EDIT, DELETE)
  // =========================================================================

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.MESSAGE_SEND)
  async handleSendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: SendRealtimeMessagePayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.conversationId || !isValidObjectId(payload.conversationId)) {
        throw new BadRequestException('Valid conversationId is required');
      }

      // Validate message body using existing schema
      const validatedDto = sendMessageSchema.parse({
        content: payload.content,
        type: payload.type,
        metadata: payload.metadata,
        clientMessageId: payload.clientMessageId,
      });

      // Delegate directly to MessageService (enforces project isolation & membership)
      const message = await this.messageService.sendMessage(
        project.id,
        payload.conversationId,
        user.id,
        validatedDto,
      );

      // Broadcast to conversation room
      this.server
        .to(REALTIME_ROOMS.conversation(payload.conversationId))
        .emit(REALTIME_EVENTS.SERVER.MESSAGE_NEW, message);

      // Also broadcast to each participant's personal room so their sidebar list updates instantly
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId: payload.conversationId },
        select: { userId: true },
      });
      for (const p of participants) {
        this.server
          .to(REALTIME_ROOMS.user(p.userId))
          .emit(REALTIME_EVENTS.SERVER.MESSAGE_NEW, message);
      }

      return {
        success: true,
        message,
        data: message,
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.MESSAGE_EDIT)
  async handleEditMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: EditRealtimeMessagePayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.messageId || !isValidObjectId(payload.messageId)) {
        throw new BadRequestException('Valid messageId is required');
      }

      const validatedDto = updateMessageSchema.parse({
        content: payload.content,
      });

      // Delegate directly to MessageService (enforces sender ownership & TEXT constraint)
      const updatedMessage = await this.messageService.updateMessage(
        project.id,
        payload.messageId,
        user.id,
        validatedDto,
      );

      // Broadcast update to conversation room
      this.server
        .to(REALTIME_ROOMS.conversation(updatedMessage.conversationId))
        .emit(REALTIME_EVENTS.SERVER.MESSAGE_UPDATED, updatedMessage);

      return {
        success: true,
        message: updatedMessage,
        data: updatedMessage,
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.MESSAGE_DELETE)
  async handleDeleteMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: DeleteRealtimeMessagePayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.messageId || !isValidObjectId(payload.messageId)) {
        throw new BadRequestException('Valid messageId is required');
      }

      // Delegate directly to MessageService (sender authorization & soft delete)
      const deleteResult = await this.messageService.deleteMessage(
        project.id,
        payload.messageId,
        user.id,
      );

      const conversationId = deleteResult.data?.conversationId;
      const deletedAt = deleteResult.data?.deletedAt;

      const eventPayload = {
        messageId: payload.messageId,
        conversationId,
        deletedAt,
      };

      if (conversationId) {
        // Broadcast deletion event without leaking deleted message content
        this.server
          .to(REALTIME_ROOMS.conversation(conversationId))
          .emit(REALTIME_EVENTS.SERVER.MESSAGE_DELETED, eventPayload);
      }

      return {
        success: true,
        data: eventPayload,
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  // =========================================================================
  // 3. REALTIME RECEIPTS (DELIVERED, READ, BULK READ)
  // =========================================================================

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.MESSAGE_DELIVERED)
  async handleMarkDelivered(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: MarkDeliveredPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.messageId || !isValidObjectId(payload.messageId)) {
        throw new BadRequestException('Valid messageId is required');
      }

      const receipt = await this.messageReceiptService.markDelivered(
        project.id,
        payload.messageId,
        user.id,
      );

      const deliveryPayload = {
        messageId: receipt.messageId,
        userId: receipt.userId,
        deliveredAt: receipt.deliveredAt,
        conversationId: receipt.conversationId,
      };

      if (receipt.conversationId) {
        this.server
          .to(REALTIME_ROOMS.conversation(receipt.conversationId))
          .emit(
            REALTIME_EVENTS.SERVER.MESSAGE_DELIVERY_UPDATED,
            deliveryPayload,
          );
      }

      return {
        success: true,
        data: deliveryPayload,
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.MESSAGE_READ)
  async handleMarkRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: MarkReadPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.messageId || !isValidObjectId(payload.messageId)) {
        throw new BadRequestException('Valid messageId is required');
      }

      const receipt = await this.messageReceiptService.markRead(
        project.id,
        payload.messageId,
        user.id,
      );

      const readPayload = {
        messageId: receipt.messageId,
        userId: receipt.userId,
        readAt: receipt.readAt,
        deliveredAt: receipt.deliveredAt,
        conversationId: receipt.conversationId,
      };

      if (receipt.conversationId) {
        this.server
          .to(REALTIME_ROOMS.conversation(receipt.conversationId))
          .emit(REALTIME_EVENTS.SERVER.MESSAGE_READ_UPDATED, readPayload);
      }

      return {
        success: true,
        data: readPayload,
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CONVERSATION_READ)
  async handleConversationRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: BulkConversationReadPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.conversationId || !isValidObjectId(payload.conversationId)) {
        throw new BadRequestException('Valid conversationId is required');
      }

      const validatedDto = bulkMarkReadSchema.parse({
        messageId: payload.messageId,
      });

      const result = await this.messageReceiptService.markMessagesAsRead(
        project.id,
        payload.conversationId,
        user.id,
        validatedDto,
      );

      const readUpdatePayload = {
        conversationId: payload.conversationId,
        userId: user.id,
        markedCount: result.markedCount,
        lastReadMessageId: result.lastReadMessageId,
        readAt: new Date(),
      };

      this.server
        .to(REALTIME_ROOMS.conversation(payload.conversationId))
        .emit(
          REALTIME_EVENTS.SERVER.CONVERSATION_READ_UPDATED,
          readUpdatePayload,
        );

      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  // =========================================================================
  // 5. TYPING INDICATOR HANDLERS
  // =========================================================================

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.TYPING_START)
  async handleTypingStart(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: TypingStartPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.conversationId || !isValidObjectId(payload.conversationId)) {
        throw new BadRequestException('Valid conversationId is required');
      }

      const { shouldBroadcast } = await this.typingService.startTyping(
        project.id,
        payload.conversationId,
        user.id,
        socket.id,
        () => {
          this.server
            .to(REALTIME_ROOMS.conversation(payload.conversationId))
            .emit(REALTIME_EVENTS.SERVER.TYPING_STOPPED, {
              conversationId: payload.conversationId,
              userId: user.id,
            });
        },
      );

      if (shouldBroadcast) {
        socket.broadcast
          .to(REALTIME_ROOMS.conversation(payload.conversationId))
          .emit(REALTIME_EVENTS.SERVER.TYPING_STARTED, {
            conversationId: payload.conversationId,
            userId: user.id,
          });
      }

      return {
        success: true,
        data: {
          conversationId: payload.conversationId,
          userId: user.id,
          typing: true,
        },
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.TYPING_STOP)
  async handleTypingStop(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: TypingStopPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.conversationId || !isValidObjectId(payload.conversationId)) {
        throw new BadRequestException('Valid conversationId is required');
      }

      await this.conversationService.findById(
        project.id,
        payload.conversationId,
        user.id,
      );

      const { shouldBroadcast } = this.typingService.stopTyping(
        project.id,
        payload.conversationId,
        user.id,
      );

      if (shouldBroadcast) {
        socket.broadcast
          .to(REALTIME_ROOMS.conversation(payload.conversationId))
          .emit(REALTIME_EVENTS.SERVER.TYPING_STOPPED, {
            conversationId: payload.conversationId,
            userId: user.id,
          });
      }

      return {
        success: true,
        data: {
          conversationId: payload.conversationId,
          userId: user.id,
          typing: false,
        },
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      socket.emit(REALTIME_EVENTS.SERVER.SOCKET_ERROR, errorAck);
      return errorAck;
    }
  }

  /**
   * Relay message request send event
   */
  @SubscribeMessage('request:send')
  async handleRequestSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { receiverId: string; message?: string },
  ) {
    const user = socket.data?.communicationUser as CommunicationUser | undefined;
    const project = socket.data?.project as Project | undefined;
    if (!user || !project || !payload?.receiverId) return;

    this.server.to(REALTIME_ROOMS.user(payload.receiverId)).emit('request:new', {
      projectId: project.id,
      senderId: user.id,
      receiverId: payload.receiverId,
      message: payload.message || null,
      status: 'PENDING',
      sender: user,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Relay message request accept event
   */
  @SubscribeMessage('request:accept')
  async handleRequestAccept(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { requestId: string; senderId?: string },
  ) {
    const user = socket.data?.communicationUser as CommunicationUser | undefined;
    if (!user || !payload?.requestId) return;

    if (payload.senderId) {
      this.server.to(REALTIME_ROOMS.user(payload.senderId)).emit('request:accepted', {
        request: {
          id: payload.requestId,
          status: 'ACCEPTED',
          senderId: payload.senderId,
          receiverId: user.id,
          receiver: user,
        },
      });
    }
  }

  /**
   * Relay message request reject event
   */
  @SubscribeMessage('request:reject')
  async handleRequestReject(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { requestId: string; senderId?: string },
  ) {
    const user = socket.data?.communicationUser as CommunicationUser | undefined;
    if (!user || !payload?.requestId) return;

    if (payload.senderId) {
      this.server.to(REALTIME_ROOMS.user(payload.senderId)).emit('request:rejected', {
        requestId: payload.requestId,
        request: { id: payload.requestId, status: 'REJECTED' },
      });
    }
  }

  /**
   * Relay message request cancel event
   */
  @SubscribeMessage('request:cancel')
  async handleRequestCancel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { requestId: string; receiverId?: string },
  ) {
    if (!payload?.requestId) return;

    if (payload.receiverId) {
      this.server.to(REALTIME_ROOMS.user(payload.receiverId)).emit('request:cancelled', {
        requestId: payload.requestId,
      });
    }
  }

  // =========================================================================
  // 6. PHASE 2: CALL SIGNALING (START, ACCEPT, REJECT, CANCEL, END)
  // =========================================================================

  /**
   * Client initiates a 1-to-1 call
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CALL_START)
  async handleCallStart(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallStartPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.conversationId || !isValidObjectId(payload.conversationId)) {
        throw new BadRequestException('Valid conversationId is required');
      }
      if (payload.callType !== undefined && payload.callType !== 'AUDIO' && payload.callType !== 'VIDEO') {
        throw new BadRequestException('callType must be AUDIO or VIDEO');
      }

      const result = await this.callSignalingService.startCall(
        project.id,
        user,
        payload.conversationId,
        payload.callType,
      );

      if (result.isBusy) {
        const busyPayload: CallBusyPayload = {
          callId: result.callId,
          conversationId: result.conversationId,
          userId: result.receiverId,
          reason: 'Participant is currently busy on another call',
        };

        socket.emit(REALTIME_EVENTS.SERVER.CALL_BUSY, busyPayload);

        return {
          success: true,
          data: {
            callId: result.callId,
            conversationId: result.conversationId,
            status: CallState.BUSY,
            busyUserId: result.receiverId,
            receiverOnline: false,
          },
        };
      }

      // Receiver is available -> emit call:incoming to receiver's user room
      const incomingPayload: CallIncomingPayload = {
        callId: result.call.id,
        conversationId: result.call.conversationId,
        caller: {
          id: user.id,
          externalId: user.externalId,
          name: user.name,
          avatar: user.avatar,
        },
        callType: result.call.callType,
      };

      this.server
        .to(REALTIME_ROOMS.user(result.call.receiverId))
        .emit(REALTIME_EVENTS.SERVER.CALL_INCOMING, incomingPayload);

      return {
        success: true,
        data: {
          callId: result.call.id,
          conversationId: result.call.conversationId,
          status: result.call.status,
          receiverOnline: result.receiverOnline,
        },
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      const errorPayload: CallErrorPayload = {
        code: errorAck.error.code,
        message: errorAck.error.message,
      };
      socket.emit(REALTIME_EVENTS.SERVER.CALL_ERROR, errorPayload);
      return errorAck;
    }
  }

  /**
   * Receiver accepts an incoming ringing call
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CALL_ACCEPT)
  async handleCallAccept(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallAcceptPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.callId) {
        throw new BadRequestException('callId is required');
      }

      const call = await this.callSignalingService.acceptCall(
        project.id,
        user.id,
        payload.callId,
      );

      const eventPayload: CallAcceptedPayload = {
        callId: call.id,
        conversationId: call.conversationId,
        acceptedBy: user.id,
      };

      // Notify caller
      this.server
        .to(REALTIME_ROOMS.user(call.callerId))
        .emit(REALTIME_EVENTS.SERVER.CALL_ACCEPTED, eventPayload);

      // Notify other devices of receiver so they stop ringing
      this.server
        .to(REALTIME_ROOMS.user(call.receiverId))
        .emit(REALTIME_EVENTS.SERVER.CALL_ACCEPTED, eventPayload);

      return {
        success: true,
        data: {
          callId: call.id,
          status: call.status,
        },
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      const errorPayload: CallErrorPayload = {
        code: errorAck.error.code,
        message: errorAck.error.message,
        callId: payload?.callId,
      };
      socket.emit(REALTIME_EVENTS.SERVER.CALL_ERROR, errorPayload);
      return errorAck;
    }
  }

  /**
   * Receiver rejects an incoming ringing call
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CALL_REJECT)
  async handleCallReject(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallRejectPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.callId) {
        throw new BadRequestException('callId is required');
      }

      const call = await this.callSignalingService.rejectCall(
        project.id,
        user.id,
        payload.callId,
      );

      const eventPayload: CallRejectedPayload = {
        callId: call.id,
        conversationId: call.conversationId,
        rejectedBy: user.id,
      };

      this.server
        .to(REALTIME_ROOMS.user(call.callerId))
        .emit(REALTIME_EVENTS.SERVER.CALL_REJECTED, eventPayload);

      this.server
        .to(REALTIME_ROOMS.user(call.receiverId))
        .emit(REALTIME_EVENTS.SERVER.CALL_REJECTED, eventPayload);

      return {
        success: true,
        data: {
          callId: call.id,
          status: CallState.REJECTED,
        },
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      const errorPayload: CallErrorPayload = {
        code: errorAck.error.code,
        message: errorAck.error.message,
        callId: payload?.callId,
      };
      socket.emit(REALTIME_EVENTS.SERVER.CALL_ERROR, errorPayload);
      return errorAck;
    }
  }

  /**
   * Caller cancels a ringing call before pickup
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CALL_CANCEL)
  async handleCallCancel(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallCancelPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.callId) {
        throw new BadRequestException('callId is required');
      }

      const call = await this.callSignalingService.cancelCall(
        project.id,
        user.id,
        payload.callId,
      );

      const eventPayload: CallCancelledPayload = {
        callId: call.id,
        conversationId: call.conversationId,
        cancelledBy: user.id,
      };

      this.server
        .to(REALTIME_ROOMS.user(call.receiverId))
        .emit(REALTIME_EVENTS.SERVER.CALL_CANCELLED, eventPayload);

      return {
        success: true,
        data: {
          callId: call.id,
          status: CallState.CANCELLED,
        },
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      const errorPayload: CallErrorPayload = {
        code: errorAck.error.code,
        message: errorAck.error.message,
        callId: payload?.callId,
      };
      socket.emit(REALTIME_EVENTS.SERVER.CALL_ERROR, errorPayload);
      return errorAck;
    }
  }

  /**
   * Participant terminates an active or ringing call
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage(REALTIME_EVENTS.CLIENT.CALL_END)
  async handleCallEnd(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallEndPayload,
  ): Promise<RealtimeAckResponse> {
    const project = socket.data.project;
    const user = socket.data.communicationUser;

    try {
      if (!payload || !payload.callId) {
        throw new BadRequestException('callId is required');
      }

      const call = await this.callSignalingService.endCall(
        project.id,
        user.id,
        payload.callId,
      );

      const eventPayload: CallEndedPayload = {
        callId: call.id,
        conversationId: call.conversationId,
        endedBy: user.id,
      };

      this.server
        .to(REALTIME_ROOMS.user(call.callerId))
        .emit(REALTIME_EVENTS.SERVER.CALL_ENDED, eventPayload);

      this.server
        .to(REALTIME_ROOMS.user(call.receiverId))
        .emit(REALTIME_EVENTS.SERVER.CALL_ENDED, eventPayload);

      return {
        success: true,
        data: {
          callId: call.id,
          status: CallState.ENDED,
        },
      };
    } catch (err: unknown) {
      const errorAck = this.formatError(err);
      const errorPayload: CallErrorPayload = {
        code: errorAck.error.code,
        message: errorAck.error.message,
        callId: payload?.callId,
      };
      socket.emit(REALTIME_EVENTS.SERVER.CALL_ERROR, errorPayload);
      return errorAck;
    }
  }
}

