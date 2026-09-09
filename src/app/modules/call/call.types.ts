export interface CallTokenResult {
  token: string;
  serverUrl: string;
  roomName: string;
}

export enum CallState {
  IDLE = 'IDLE',
  RINGING = 'RINGING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  ENDED = 'ENDED',
  BUSY = 'BUSY',
}

export type CallType = 'VIDEO' | 'AUDIO';

export interface CallSession {
  id: string;
  projectId: string;
  conversationId: string;
  callerId: string;
  receiverId: string;
  status: CallState;
  callType: CallType;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

export const VALID_CALL_TRANSITIONS: Record<CallState, readonly CallState[]> = {
  [CallState.IDLE]: [CallState.RINGING, CallState.BUSY],
  [CallState.RINGING]: [
    CallState.ACCEPTED,
    CallState.REJECTED,
    CallState.CANCELLED,
    CallState.ENDED,
  ],
  [CallState.ACCEPTED]: [CallState.ENDED],
  [CallState.REJECTED]: [],
  [CallState.CANCELLED]: [],
  [CallState.ENDED]: [],
  [CallState.BUSY]: [],
} as const;
