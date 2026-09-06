import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PRESENCE_STORE,
  PresenceStore,
  UserPresence,
} from './presence.store.interface';
import { PrismaService } from '../../../database/prisma.service';
import {
  NotFoundException,
  ForbiddenException,
} from '../../../common/exceptions/domain.exceptions';
import { REALTIME_ROOMS } from '../realtime.constants';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    @Inject(PRESENCE_STORE)
    private readonly presenceStore: PresenceStore,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Handle socket connection for a user.
   * Updates MongoDB only on true transition from 0 -> 1 active sockets.
   */
  async handleConnect(
    projectId: string,
    userId: string,
    socketId: string,
  ): Promise<{ isTransition: boolean; presence: UserPresence }> {
    const isTransition = this.presenceStore.addSocket(
      projectId,
      userId,
      socketId,
    );

    if (isTransition) {
      try {
        await this.prisma.communicationUser.update({
          where: { id: userId },
          data: {
            isOnline: true,
          },
        });
        this.logger.log(
          `User ${userId} transitioned OFFLINE -> ONLINE in project ${projectId}`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to update isOnline in DB for user ${userId}:`,
          err,
        );
      }
    }

    return {
      isTransition,
      presence: {
        userId,
        isOnline: true,
        lastSeenAt: null,
      },
    };
  }

  /**
   * Handle socket disconnection.
   * Updates MongoDB with lastSeenAt only when final socket disconnects (1 -> 0).
   */
  async handleDisconnect(socketId: string): Promise<{
    projectId: string;
    userId: string;
    isTransition: boolean;
    presence: UserPresence;
  } | null> {
    const removed = this.presenceStore.removeSocketById(socketId);
    if (!removed) {
      return null;
    }

    const { projectId, userId, isNowOffline } = removed;

    if (isNowOffline) {
      const lastSeenAt = new Date();
      try {
        await this.prisma.communicationUser.update({
          where: { id: userId },
          data: {
            isOnline: false,
            lastSeenAt,
          },
        });
        this.logger.log(
          `User ${userId} transitioned ONLINE -> OFFLINE in project ${projectId}`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to update lastSeenAt in DB for user ${userId}:`,
          err,
        );
      }

      return {
        projectId,
        userId,
        isTransition: true,
        presence: {
          userId,
          isOnline: false,
          lastSeenAt,
        },
      };
    }

    return {
      projectId,
      userId,
      isTransition: false,
      presence: {
        userId,
        isOnline: true,
        lastSeenAt: null,
      },
    };
  }

  /**
   * Get single user presence within project boundary.
   */
  async getPresence(projectId: string, userId: string): Promise<UserPresence> {
    const user = await this.prisma.communicationUser.findFirst({
      where: {
        projectId,
        OR: [{ id: userId }, { externalId: userId }],
      },
      select: {
        id: true,
        isOnline: true,
        lastSeenAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('CommunicationUser', userId);
    }

    const isOnline = this.presenceStore.isOnline(projectId, user.id);

    return {
      userId: user.id,
      isOnline,
      lastSeenAt: isOnline ? null : user.lastSeenAt || null,
    };
  }

  /**
   * Get presence snapshot for all participants in a conversation.
   * Enforces conversation access and project isolation.
   */
  async getConversationPresence(
    projectId: string,
    conversationId: string,
    requesterId: string,
  ): Promise<UserPresence[]> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        projectId,
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                isOnline: true,
                lastSeenAt: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation', conversationId);
    }

    const isMember = conversation.participants.some(
      (p) => p.userId === requesterId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'You are not a member of this conversation',
      );
    }

    return conversation.participants.map((p) => {
      const isOnline = this.presenceStore.isOnline(projectId, p.userId);
      return {
        userId: p.userId,
        isOnline,
        lastSeenAt: isOnline ? null : p.user.lastSeenAt || null,
      };
    });
  }

  /**
   * Get all conversation rooms for a user to broadcast presence changes.
   */
  async getUserConversationRooms(
    projectId: string,
    userId: string,
  ): Promise<string[]> {
    const participations = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });

    if (!participations || participations.length === 0) {
      return [];
    }

    const conversationIds = participations.map((p) => p.conversationId);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        id: { in: conversationIds },
        projectId,
      },
      select: {
        id: true,
      },
    });

    return conversations.map((c) => REALTIME_ROOMS.conversation(c.id));
  }

  /**
   * Clear in-memory presence store (for testing).
   */
  clear(): void {
    this.presenceStore.clear();
  }
}
