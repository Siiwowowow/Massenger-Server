import { Socket } from 'socket.io';
import { Project, CommunicationUser, MessageType } from '../../../generated/prisma';
import { RealtimeErrorCode } from './realtime.constants';

export interface AuthenticatedSocketData {
  project: Project;
  communicationUser: CommunicationUser;
}

export interface AuthenticatedSocket extends Socket {
  data: AuthenticatedSocketData;
}

export interface RealtimeSuccessAck<T = unknown> {
  success: true;
  data?: T;
  message?: T;
}

export interface RealtimeErrorDetail {
  code: RealtimeErrorCode | string;
  message: string;
  details?: unknown;
}

export interface RealtimeErrorAck {
  success: false;
  error: RealtimeErrorDetail;
}

export type RealtimeAckResponse<T = unknown> =
  | RealtimeSuccessAck<T>
  | RealtimeErrorAck;

export interface JoinConversationPayload {
  conversationId: string;
}

export interface LeaveConversationPayload {
  conversationId: string;
}

export interface SendRealtimeMessagePayload {
  conversationId: string;
  content: string;
  type?: MessageType;
  metadata?: Record<string, unknown> | null;
  clientMessageId?: string | null;
}

export interface EditRealtimeMessagePayload {
  messageId: string;
  content: string;
}

export interface DeleteRealtimeMessagePayload {
  messageId: string;
}

export interface MarkDeliveredPayload {
  messageId: string;
}

export interface MarkReadPayload {
  messageId: string;
}

export interface BulkConversationReadPayload {
  conversationId: string;
  messageId?: string;
}

export interface TypingStartPayload {
  conversationId: string;
}

export interface TypingStopPayload {
  conversationId: string;
}

export interface PresenceOnlinePayload {
  userId: string;
  isOnline: true;
}

export interface PresenceOfflinePayload {
  userId: string;
  isOnline: false;
  lastSeenAt: Date | string;
}

export interface TypingStartedPayload {
  conversationId: string;
  userId: string;
}

export interface TypingStoppedPayload {
  conversationId: string;
  userId: string;
}

