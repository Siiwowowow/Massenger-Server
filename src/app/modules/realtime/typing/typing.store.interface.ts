export const TYPING_STORE = 'TYPING_STORE';

export interface TypingStore {
  /**
   * Start typing.
   * If already typing: refreshes timeout and returns false (deduplication).
   * If first start: sets timeout and returns true.
   */
  startTyping(
    projectId: string,
    conversationId: string,
    userId: string,
    socketId: string,
    timeoutMs: number,
    onTimeout: () => void,
  ): boolean;

  /**
   * Stop typing.
   * Returns true if user was typing and state was cleared.
   */
  stopTyping(
    projectId: string,
    conversationId: string,
    userId: string,
  ): boolean;

  /**
   * Check if a user is currently typing in a conversation.
   */
  isTyping(projectId: string, conversationId: string, userId: string): boolean;

  /**
   * Get all user IDs currently typing in a conversation.
   */
  getTypingUsers(projectId: string, conversationId: string): string[];

  /**
   * Clean up all active typing states associated with a disconnecting socket.
   */
  cleanupSocket(
    socketId: string,
  ): Array<{ projectId: string; conversationId: string; userId: string }>;

  /**
   * Clear all typing states and cancel all active timers.
   */
  clear(): void;
}
