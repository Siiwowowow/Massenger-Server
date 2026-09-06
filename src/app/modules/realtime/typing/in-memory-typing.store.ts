import { Injectable } from '@nestjs/common';
import { TypingStore } from './typing.store.interface';

interface ActiveTypingEntry {
  socketId: string;
  timeoutRef: NodeJS.Timeout;
}

/**
 * In-memory implementation of TypingStore.
 *
 * NOTE: In-memory typing is single-process ephemeral state. In a multi-instance
 * cluster, this can be swapped with RedisTypingStore implementing the same
 * TypingStore interface.
 */
@Injectable()
export class InMemoryTypingStore implements TypingStore {
  // Key: `${projectId}:${conversationId}` -> Map<userId, ActiveTypingEntry>
  private readonly conversationTyping = new Map<
    string,
    Map<string, ActiveTypingEntry>
  >();

  // Key: socketId -> Set<`${projectId}:${conversationId}:${userId}`>
  private readonly socketTyping = new Map<string, Set<string>>();

  private getConversationKey(projectId: string, conversationId: string): string {
    return `${projectId}:${conversationId}`;
  }

  private getEntryKey(
    projectId: string,
    conversationId: string,
    userId: string,
  ): string {
    return `${projectId}:${conversationId}:${userId}`;
  }

  startTyping(
    projectId: string,
    conversationId: string,
    userId: string,
    socketId: string,
    timeoutMs: number,
    onTimeout: () => void,
  ): boolean {
    const convKey = this.getConversationKey(projectId, conversationId);
    let usersMap = this.conversationTyping.get(convKey);

    if (!usersMap) {
      usersMap = new Map<string, ActiveTypingEntry>();
      this.conversationTyping.set(convKey, usersMap);
    }

    const existing = usersMap.get(userId);

    if (existing) {
      // Refresh timeout only (deduplication)
      clearTimeout(existing.timeoutRef);
      existing.socketId = socketId;
      existing.timeoutRef = setTimeout(() => {
        this.handleTimeoutExpiry(projectId, conversationId, userId, onTimeout);
      }, timeoutMs);

      return false;
    }

    // New typing start
    const timeoutRef = setTimeout(() => {
      this.handleTimeoutExpiry(projectId, conversationId, userId, onTimeout);
    }, timeoutMs);

    usersMap.set(userId, { socketId, timeoutRef });

    // Track socket association
    let socketSet = this.socketTyping.get(socketId);
    if (!socketSet) {
      socketSet = new Set<string>();
      this.socketTyping.set(socketId, socketSet);
    }
    socketSet.add(this.getEntryKey(projectId, conversationId, userId));

    return true;
  }

  stopTyping(
    projectId: string,
    conversationId: string,
    userId: string,
  ): boolean {
    const convKey = this.getConversationKey(projectId, conversationId);
    const usersMap = this.conversationTyping.get(convKey);

    if (!usersMap) {
      return false;
    }

    const existing = usersMap.get(userId);
    if (!existing) {
      return false;
    }

    clearTimeout(existing.timeoutRef);
    usersMap.delete(userId);

    if (usersMap.size === 0) {
      this.conversationTyping.delete(convKey);
    }

    // Remove from socket reverse tracking
    const socketSet = this.socketTyping.get(existing.socketId);
    if (socketSet) {
      socketSet.delete(this.getEntryKey(projectId, conversationId, userId));
      if (socketSet.size === 0) {
        this.socketTyping.delete(existing.socketId);
      }
    }

    return true;
  }

  isTyping(projectId: string, conversationId: string, userId: string): boolean {
    const convKey = this.getConversationKey(projectId, conversationId);
    const usersMap = this.conversationTyping.get(convKey);
    return Boolean(usersMap && usersMap.has(userId));
  }

  getTypingUsers(projectId: string, conversationId: string): string[] {
    const convKey = this.getConversationKey(projectId, conversationId);
    const usersMap = this.conversationTyping.get(convKey);
    return usersMap ? Array.from(usersMap.keys()) : [];
  }

  cleanupSocket(
    socketId: string,
  ): Array<{ projectId: string; conversationId: string; userId: string }> {
    const socketSet = this.socketTyping.get(socketId);
    if (!socketSet || socketSet.size === 0) {
      this.socketTyping.delete(socketId);
      return [];
    }

    const stopped: Array<{
      projectId: string;
      conversationId: string;
      userId: string;
    }> = [];

    for (const entryKey of socketSet) {
      const parts = entryKey.split(':');
      if (parts.length >= 3) {
        const projectId = parts[0];
        const conversationId = parts[1];
        const userId = parts[2];

        const convKey = this.getConversationKey(projectId, conversationId);
        const usersMap = this.conversationTyping.get(convKey);
        if (usersMap) {
          const existing = usersMap.get(userId);
          if (existing && existing.socketId === socketId) {
            clearTimeout(existing.timeoutRef);
            usersMap.delete(userId);
            if (usersMap.size === 0) {
              this.conversationTyping.delete(convKey);
            }
            stopped.push({ projectId, conversationId, userId });
          }
        }
      }
    }

    this.socketTyping.delete(socketId);
    return stopped;
  }

  clear(): void {
    for (const usersMap of this.conversationTyping.values()) {
      for (const entry of usersMap.values()) {
        clearTimeout(entry.timeoutRef);
      }
      usersMap.clear();
    }
    this.conversationTyping.clear();
    this.socketTyping.clear();
  }

  private handleTimeoutExpiry(
    projectId: string,
    conversationId: string,
    userId: string,
    onTimeout: () => void,
  ) {
    const convKey = this.getConversationKey(projectId, conversationId);
    const usersMap = this.conversationTyping.get(convKey);

    if (usersMap) {
      const existing = usersMap.get(userId);
      if (existing) {
        usersMap.delete(userId);
        if (usersMap.size === 0) {
          this.conversationTyping.delete(convKey);
        }

        const socketSet = this.socketTyping.get(existing.socketId);
        if (socketSet) {
          socketSet.delete(
            this.getEntryKey(projectId, conversationId, userId),
          );
          if (socketSet.size === 0) {
            this.socketTyping.delete(existing.socketId);
          }
        }
      }
    }

    try {
      onTimeout();
    } catch {
      // Ignore errors in timeout callback
    }
  }
}
