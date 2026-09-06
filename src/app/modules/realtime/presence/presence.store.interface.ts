export interface UserPresence {
  userId: string;
  isOnline: boolean;
  lastSeenAt: Date | null;
}

export const PRESENCE_STORE = 'PRESENCE_STORE';

export interface PresenceStore {
  /**
   * Add a socket connection for a user in a project.
   * Returns true if user was previously offline (first socket connected).
   */
  addSocket(projectId: string, userId: string, socketId: string): boolean;

  /**
   * Remove a socket connection for a user in a project.
   * Returns true if user is now offline (0 remaining sockets).
   */
  removeSocket(
    projectId: string,
    userId: string,
    socketId: string,
  ): { isNowOffline: boolean; remainingSockets: number };

  /**
   * Remove a socket by socketId (resolving its project/user context).
   */
  removeSocketById(socketId: string): {
    projectId: string;
    userId: string;
    isNowOffline: boolean;
    remainingSockets: number;
  } | null;

  /**
   * Check if a user is currently online in a project.
   */
  isOnline(projectId: string, userId: string): boolean;

  /**
   * Get all active socket IDs for a user in a project.
   */
  getSockets(projectId: string, userId: string): string[];

  /**
   * Get all online user IDs in a project.
   */
  getOnlineUsers(projectId: string): string[];

  /**
   * Clear all active presence records (for test cleanup).
   */
  clear(): void;
}
