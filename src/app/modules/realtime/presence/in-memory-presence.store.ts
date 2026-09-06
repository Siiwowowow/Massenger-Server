import { Injectable } from '@nestjs/common';
import { PresenceStore } from './presence.store.interface';

/**
 * In-memory implementation of PresenceStore.
 *
 * NOTE: In-memory presence is single-process state. In a multi-instance
 * distributed cluster, this can be swapped with RedisPresenceStore implementing
 * the same PresenceStore interface without altering gateway or service code.
 */
@Injectable()
export class InMemoryPresenceStore implements PresenceStore {
  // Key: `${projectId}:${userId}` -> Set of active socket IDs
  private readonly userSockets = new Map<string, Set<string>>();

  // Key: socketId -> { projectId, userId } for fast disconnect lookup
  private readonly socketToUser = new Map<
    string,
    { projectId: string; userId: string }
  >();

  private getKey(projectId: string, userId: string): string {
    return `${projectId}:${userId}`;
  }

  addSocket(projectId: string, userId: string, socketId: string): boolean {
    const key = this.getKey(projectId, userId);
    let sockets = this.userSockets.get(key);
    const wasOffline = !sockets || sockets.size === 0;

    if (!sockets) {
      sockets = new Set<string>();
      this.userSockets.set(key, sockets);
    }

    sockets.add(socketId);
    this.socketToUser.set(socketId, { projectId, userId });

    return wasOffline;
  }

  removeSocket(
    projectId: string,
    userId: string,
    socketId: string,
  ): { isNowOffline: boolean; remainingSockets: number } {
    const key = this.getKey(projectId, userId);
    const sockets = this.userSockets.get(key);
    this.socketToUser.delete(socketId);

    if (!sockets) {
      return { isNowOffline: true, remainingSockets: 0 };
    }

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.userSockets.delete(key);
      return { isNowOffline: true, remainingSockets: 0 };
    }

    return { isNowOffline: false, remainingSockets: sockets.size };
  }

  removeSocketById(socketId: string): {
    projectId: string;
    userId: string;
    isNowOffline: boolean;
    remainingSockets: number;
  } | null {
    const info = this.socketToUser.get(socketId);
    if (!info) {
      return null;
    }

    const { isNowOffline, remainingSockets } = this.removeSocket(
      info.projectId,
      info.userId,
      socketId,
    );

    return {
      projectId: info.projectId,
      userId: info.userId,
      isNowOffline,
      remainingSockets,
    };
  }

  isOnline(projectId: string, userId: string): boolean {
    const key = this.getKey(projectId, userId);
    const sockets = this.userSockets.get(key);
    return Boolean(sockets && sockets.size > 0);
  }

  getSockets(projectId: string, userId: string): string[] {
    const key = this.getKey(projectId, userId);
    const sockets = this.userSockets.get(key);
    return sockets ? Array.from(sockets) : [];
  }

  getOnlineUsers(projectId: string): string[] {
    const prefix = `${projectId}:`;
    const onlineUsers: string[] = [];

    for (const [key, sockets] of this.userSockets.entries()) {
      if (key.startsWith(prefix) && sockets.size > 0) {
        onlineUsers.push(key.slice(prefix.length));
      }
    }

    return onlineUsers;
  }

  clear(): void {
    this.userSockets.clear();
    this.socketToUser.clear();
  }
}
