import { Inject, Injectable, Logger } from '@nestjs/common';
import { TYPING_STORE, TypingStore } from './typing.store.interface';
import { ConversationService } from '../../conversation/conversation.service';

@Injectable()
export class TypingService {
  private readonly logger = new Logger(TypingService.name);
  private static readonly TYPING_TIMEOUT_MS = 5000;

  constructor(
    @Inject(TYPING_STORE)
    private readonly typingStore: TypingStore,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * Start typing in a conversation.
   * Validates participant membership and project isolation.
   * Returns whether the event should be broadcasted (false if duplicate/refresh).
   */
  async startTyping(
    projectId: string,
    conversationId: string,
    userId: string,
    socketId: string,
    onTimeout: () => void,
  ): Promise<{ shouldBroadcast: boolean }> {
    // Validate that the conversation exists and user is a participant
    await this.conversationService.findById(projectId, conversationId, userId);

    const shouldBroadcast = this.typingStore.startTyping(
      projectId,
      conversationId,
      userId,
      socketId,
      TypingService.TYPING_TIMEOUT_MS,
      onTimeout,
    );

    return { shouldBroadcast };
  }

  /**
   * Stop typing in a conversation.
   * Returns whether the user was actually typing (should broadcast stop).
   */
  stopTyping(
    projectId: string,
    conversationId: string,
    userId: string,
  ): { shouldBroadcast: boolean } {
    const shouldBroadcast = this.typingStore.stopTyping(
      projectId,
      conversationId,
      userId,
    );
    return { shouldBroadcast };
  }

  /**
   * Check if a user is currently typing.
   */
  isTyping(projectId: string, conversationId: string, userId: string): boolean {
    return this.typingStore.isTyping(projectId, conversationId, userId);
  }

  /**
   * Get all typing user IDs in a conversation.
   */
  getTypingUsers(projectId: string, conversationId: string): string[] {
    return this.typingStore.getTypingUsers(projectId, conversationId);
  }

  /**
   * Cleanup any typing state associated with a disconnecting socket.
   */
  cleanupSocket(
    socketId: string,
  ): Array<{ projectId: string; conversationId: string; userId: string }> {
    return this.typingStore.cleanupSocket(socketId);
  }

  /**
   * Clear all typing state (for test cleanup).
   */
  clear(): void {
    this.typingStore.clear();
  }
}
