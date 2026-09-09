import { Injectable, Logger } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';
import { LiveKitService } from './livekit.service';
import { CommunicationUser } from '../../../generated/prisma';
import { CallTokenResult } from './call.types';

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly livekitService: LiveKitService,
  ) {}

  /**
   * Generates a secure LiveKit participant access token for an authenticated user in a conversation.
   *
   * Enforces:
   * 1. Multi-tenant isolation (conversation belongs to current projectId)
   * 2. Conversation existence
   * 3. Current user is an active participant/member of the conversation
   * 4. Opaque, deterministic room naming
   * 5. Minimum required media permissions
   */
  async generateToken(
    projectId: string,
    user: CommunicationUser,
    conversationId: string,
  ): Promise<CallTokenResult> {
    // 1. Validate conversation exists and user is a confirmed participant in this project
    await this.conversationService.findById(projectId, conversationId, user.id);

    // 2. Generate deterministic, opaque room name
    const roomName = this.livekitService.generateRoomName(conversationId);

    // 3. Generate secure participant access token
    const token = await this.livekitService.createParticipantToken(
      user.id,
      user.name,
      roomName,
    );

    this.logger.log(
      `Generated call token for user ${user.name} (${user.id}) in conversation ${conversationId} (room: ${roomName})`,
    );

    // 4. Return safe payload for client connection without exposing API keys or secrets
    return {
      token,
      serverUrl: this.livekitService.getServerUrl(),
      roomName,
    };
  }
}
