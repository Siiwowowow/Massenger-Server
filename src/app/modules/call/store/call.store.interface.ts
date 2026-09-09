import { CallSession } from '../call.types';

export const CALL_STORE = 'CALL_STORE';

export interface CallStore {
  /**
   * Save a newly initiated call session.
   */
  createCall(call: CallSession): Promise<CallSession>;

  /**
   * Retrieve a call session by its unique callId.
   */
  getCall(callId: string): Promise<CallSession | null>;

  /**
   * Update an existing call session (e.g. status transition, timestamps).
   */
  updateCall(
    callId: string,
    update: Partial<CallSession>,
  ): Promise<CallSession | null>;

  /**
   * Remove/delete a call session by its unique callId.
   */
  deleteCall(callId: string): Promise<boolean>;

  /**
   * Retrieve any currently active (RINGING or ACCEPTED) call for a user within a project.
   */
  getUserActiveCall(
    projectId: string,
    userId: string,
  ): Promise<CallSession | null>;

  /**
   * Check if a user is currently participating in an active call within a project.
   */
  isUserBusy(projectId: string, userId: string): Promise<boolean>;

  /**
   * Clear all call records (used for test teardown).
   */
  clear(): Promise<void>;
}
