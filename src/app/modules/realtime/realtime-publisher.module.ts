import { Injectable, Logger, Module } from '@nestjs/common';
import { Server } from 'socket.io';
import { PrismaService } from '../../database/prisma.service';
import { REALTIME_ROOMS } from './realtime.constants';

@Injectable()
export class RealtimePublisher {
  private server?: Server;
  private readonly logger = new Logger(RealtimePublisher.name);
  constructor(private readonly prisma: PrismaService) {}
  bind(server: Server) { this.server = server; }
  async publish(conversationId: string, event: string, payload: unknown, userIds?: string[]) {
    if (!this.server) return;
    try {
      const recipients = userIds ?? (await this.prisma.conversationParticipant.findMany({
        where: { conversationId }, select: { userId: true },
      })).map((participant) => participant.userId);
      this.server.to([
        REALTIME_ROOMS.conversation(conversationId),
        ...recipients.map((id) => REALTIME_ROOMS.user(id)),
      ]).emit(event, payload);
    } catch (error) { this.logger.error('Realtime broadcast failed', error); }
  }
}
@Module({ providers: [RealtimePublisher], exports: [RealtimePublisher] })
export class RealtimePublisherModule {}
