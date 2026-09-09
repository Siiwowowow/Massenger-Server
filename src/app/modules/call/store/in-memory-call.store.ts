import { Injectable } from '@nestjs/common';
import { CallStore } from './call.store.interface';
import { CallSession, CallState } from '../call.types';

@Injectable()
export class InMemoryCallStore implements CallStore {
  private readonly calls = new Map<string, CallSession>();

  async createCall(call: CallSession): Promise<CallSession> {
    const record: CallSession = {
      ...call,
      createdAt: new Date(call.createdAt || Date.now()),
      updatedAt: new Date(call.updatedAt || Date.now()),
    };
    this.calls.set(call.id, record);
    return { ...record };
  }

  async getCall(callId: string): Promise<CallSession | null> {
    const call = this.calls.get(callId);
    return call ? { ...call } : null;
  }

  async updateCall(
    callId: string,
    update: Partial<CallSession>,
  ): Promise<CallSession | null> {
    const existing = this.calls.get(callId);
    if (!existing) {
      return null;
    }

    const updated: CallSession = {
      ...existing,
      ...update,
      id: existing.id, // Preserve ID
      projectId: existing.projectId, // Preserve Project
      updatedAt: new Date(),
    };

    this.calls.set(callId, updated);
    return { ...updated };
  }

  async deleteCall(callId: string): Promise<boolean> {
    return this.calls.delete(callId);
  }

  async getUserActiveCall(
    projectId: string,
    userId: string,
  ): Promise<CallSession | null> {
    for (const call of this.calls.values()) {
      if (
        call.projectId === projectId &&
        (call.callerId === userId || call.receiverId === userId) &&
        (call.status === CallState.RINGING || call.status === CallState.ACCEPTED)
      ) {
        return { ...call };
      }
    }
    return null;
  }

  async isUserBusy(projectId: string, userId: string): Promise<boolean> {
    const active = await this.getUserActiveCall(projectId, userId);
    return active !== null;
  }

  async clear(): Promise<void> {
    this.calls.clear();
  }
}
