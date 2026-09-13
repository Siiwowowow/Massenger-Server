import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConversationService } from '../conversation/conversation.service';
import { CALL_STORE, CallStore } from './store/call.store.interface';
import {
  CallSession,
  CallState,
  CallType,
  VALID_CALL_TRANSITIONS,
} from './call.types';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '../../common/exceptions/domain.exceptions';
import { CommunicationUser, ConversationType } from '../../../generated/prisma';
import { PresenceService } from '../realtime/presence/presence.service';

export type CallStartResult =
  | {
      isBusy: true;
      callId: string;
      conversationId: string;
      receiverId: string;
    }
  | {
      isBusy: false;
      call: CallSession;
      receiver: any;
      receiverOnline: boolean;
    };

export type CallTimeoutCallback = (call: CallSession) => void | Promise<void>;

@Injectable()
export class CallSignalingService implements OnModuleDestroy {
  private readonly logger = new Logger(CallSignalingService.name);
  private readonly ringingTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly timeoutListeners: CallTimeoutCallback[] = [];
  private timeoutDurationMs = 30000; // 30 seconds default ringing timeout

  constructor(
    @Inject(CALL_STORE) private readonly callStore: CallStore,
    private readonly conversationService: ConversationService,
    private readonly presenceService: PresenceService,
  ) {}

  onModuleDestroy() {
    this.clearAllTimeouts();
  }

  /**
   * Configure ringing timeout duration (helpful for tests).
   */
  setTimeoutDuration(ms: number): void {
    this.timeoutDurationMs = ms;
  }

  /**
   * Register a callback triggered when a call times out during ringing.
   */
  onCallTimeout(callback: CallTimeoutCallback): void {
    this.timeoutListeners.push(callback);
  }

  /**
   * Validates state transitions using the explicit CallState machine.
   */
  private validateTransition(from: CallState, to: CallState): void {
    const allowed = VALID_CALL_TRANSITIONS[from];
    if (!allowed || !(allowed as readonly CallState[]).includes(to)) {
      throw new BadRequestException(
        `Invalid call state transition from ${from} to ${to}`,
      );
    }
  }

  /**
   * Clear an active ringing timeout for a call.
   */
  private clearTimer(callId: string): void {
    const timer = this.ringingTimeouts.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringingTimeouts.delete(callId);
    }
  }

  /**
   * Clear all active ringing timers (module destruction / test cleanup).
   */
  clearAllTimeouts(): void {
    for (const timer of this.ringingTimeouts.values()) {
      clearTimeout(timer);
    }
    this.ringingTimeouts.clear();
  }

  /**
   * Internal handler when ringing timer expires.
   */
  private async handleRingingTimeout(callId: string): Promise<void> {
    this.ringingTimeouts.delete(callId);
    const call = await this.callStore.getCall(callId);
    if (!call || call.status !== CallState.RINGING) {
      return;
    }

    this.logger.log(`Call ${callId} timed out in RINGING state. Cleaning up.`);
    await this.callStore.deleteCall(callId);

    const endedCall: CallSession = {
      ...call,
      status: CallState.ENDED,
      endedAt: new Date(),
    };

    for (const listener of this.timeoutListeners) {
      try {
        await listener(endedCall);
      } catch (err: unknown) {
        this.logger.error(`Error in call timeout listener: ${(err as any)?.message}`);
      }
    }
  }

  /**
   * Initiates a new 1-to-1 call attempt.
   */
  async startCall(
    projectId: string,
    caller: CommunicationUser,
    conversationId: string,
    callType: CallType = 'VIDEO',
  ): Promise<CallStartResult> {
    // 1. Verify caller is not already participating in an active call in this project
    const callerBusy = await this.callStore.isUserBusy(projectId, caller.id);
    if (callerBusy) {
      throw new BadRequestException('You are already in an active call');
    }

    // 2. Validate conversation exists in current project and caller is a member
    const conversation = await this.conversationService.findById(
      projectId,
      conversationId,
      caller.id,
    );

    // 3. Verify conversation is 1-to-1 (DIRECT)
    if (conversation.type !== ConversationType.DIRECT) {
      throw new BadRequestException(
        'Group calling is not supported in this phase',
      );
    }

    // 4. Identify the target participant
    const receiverParticipant = conversation.participants.find(
      (p) => p.userId !== caller.id,
    );

    if (!receiverParticipant) {
      throw new BadRequestException('Conversation has no other participant');
    }

    const receiverId = receiverParticipant.userId;
    const receiverOnline = (
      await this.presenceService.getPresence(projectId, receiverId)
    ).isOnline;

    // 5. Generate unique, opaque call ID (distinct from conversationId)
    const callId = `call_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

    // 6. Check if target participant is busy on another active call
    const isBusy = await this.callStore.isUserBusy(projectId, receiverId);
    if (isBusy) {
      this.logger.log(
        `Target receiver ${receiverId} is busy. Call ${callId} aborted.`,
      );
      return {
        isBusy: true,
        callId,
        conversationId,
        receiverId,
      };
    }

    // 7. Create ephemeral CallSession in state RINGING
    const session: CallSession = {
      id: callId,
      projectId,
      conversationId,
      callerId: caller.id,
      receiverId,
      status: CallState.RINGING,
      callType,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.callStore.createCall(session);

    // 8. Start ringing timeout
    const timer = setTimeout(async () => {
      await this.handleRingingTimeout(callId);
    }, this.timeoutDurationMs);
    this.ringingTimeouts.set(callId, timer);

    this.logger.log(
      `Call ${callId} started by ${caller.name} (${caller.id}) to user ${receiverId} in conversation ${conversationId}`,
    );

    return {
      isBusy: false,
      call: session,
      receiver: receiverParticipant.user,
      receiverOnline,
    };
  }

  /**
   * Accepts an active ringing call.
   */
  async acceptCall(
    projectId: string,
    userId: string,
    callId: string,
  ): Promise<CallSession> {
    const call = await this.callStore.getCall(callId);
    if (!call || call.projectId !== projectId) {
      throw new NotFoundException('Call', callId);
    }

    if (call.receiverId !== userId) {
      throw new ForbiddenException(
        'Only the intended receiver can accept this call',
      );
    }

    this.validateTransition(call.status, CallState.ACCEPTED);
    this.clearTimer(callId);

    const now = new Date();
    const updated = await this.callStore.updateCall(callId, {
      status: CallState.ACCEPTED,
      startedAt: now,
    });

    if (!updated) {
      throw new NotFoundException('Call', callId);
    }

    this.logger.log(`Call ${callId} accepted by receiver ${userId}`);
    return updated;
  }

  /**
   * Rejects an active ringing call.
   */
  async rejectCall(
    projectId: string,
    userId: string,
    callId: string,
  ): Promise<CallSession> {
    const call = await this.callStore.getCall(callId);
    if (!call || call.projectId !== projectId) {
      this.logger.warn(`Attempted to reject call ${callId} which was not found (already ended or timed out).`);
      return {
        id: callId,
        projectId,
        conversationId: '',
        callerId: '',
        receiverId: userId,
        status: CallState.REJECTED,
        callType: 'VIDEO',
        createdAt: new Date(),
        updatedAt: new Date(),
        endedAt: new Date(),
      };
    }

    if (call.receiverId !== userId) {
      throw new ForbiddenException(
        'Only the intended receiver can reject this call',
      );
    }

    this.validateTransition(call.status, CallState.REJECTED);
    this.clearTimer(callId);

    // Clean ephemeral call state upon terminal transition
    await this.callStore.deleteCall(callId);

    this.logger.log(`Call ${callId} rejected by receiver ${userId}`);
    return {
      ...call,
      status: CallState.REJECTED,
      endedAt: new Date(),
    };
  }

  /**
   * Cancels a ringing call before it is answered.
   */
  async cancelCall(
    projectId: string,
    userId: string,
    callId: string,
  ): Promise<CallSession> {
    const call = await this.callStore.getCall(callId);
    if (!call || call.projectId !== projectId) {
      this.logger.warn(`Attempted to cancel call ${callId} which was not found (already ended or timed out).`);
      return {
        id: callId,
        projectId,
        conversationId: '',
        callerId: userId,
        receiverId: '',
        status: CallState.CANCELLED,
        callType: 'VIDEO',
        createdAt: new Date(),
        updatedAt: new Date(),
        endedAt: new Date(),
      };
    }

    if (call.callerId !== userId) {
      throw new ForbiddenException('Only the caller can cancel this call');
    }

    this.validateTransition(call.status, CallState.CANCELLED);
    this.clearTimer(callId);

    // Clean ephemeral call state upon terminal transition
    await this.callStore.deleteCall(callId);

    this.logger.log(`Call ${callId} cancelled by caller ${userId}`);
    return {
      ...call,
      status: CallState.CANCELLED,
      endedAt: new Date(),
    };
  }

  /**
   * Terminates an active (ACCEPTED) or ringing (RINGING) call.
   */
  async endCall(
    projectId: string,
    userId: string,
    callId: string,
  ): Promise<CallSession> {
    const call = await this.callStore.getCall(callId);
    if (!call || call.projectId !== projectId) {
      this.logger.warn(`Attempted to end call ${callId} which was not found (already ended or timed out).`);
      return {
        id: callId,
        projectId,
        conversationId: '',
        callerId: '',
        receiverId: '',
        status: CallState.ENDED,
        callType: 'VIDEO',
        createdAt: new Date(),
        updatedAt: new Date(),
        endedAt: new Date(),
      };
    }

    if (call.callerId !== userId && call.receiverId !== userId) {
      throw new ForbiddenException('You are not a participant in this call');
    }

    this.validateTransition(call.status, CallState.ENDED);
    this.clearTimer(callId);

    // Clean ephemeral call state upon terminal transition
    await this.callStore.deleteCall(callId);

    this.logger.log(`Call ${callId} ended by participant ${userId}`);
    return {
      ...call,
      status: CallState.ENDED,
      endedAt: new Date(),
    };
  }

  /**
   * Retrieve active call session for debugging/testing.
   */
  async getCall(callId: string): Promise<CallSession | null> {
    return this.callStore.getCall(callId);
  }

  /**
   * Reset store and timeouts for testing teardown.
   */
  async reset(): Promise<void> {
    this.clearAllTimeouts();
    await this.callStore.clear();
  }
}
