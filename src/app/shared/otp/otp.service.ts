import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TokenType } from '../../../generated/prisma';
import { DateUtil } from '../../common/utils/date/date.util';
import * as crypto from 'crypto';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly verificationRequests = new Map<string, Promise<{ id: string; token: string; expiresAt: Date }>>();

  constructor(private readonly prisma: PrismaService) {}

  generateNumericOtp(length: number = 6): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return crypto.randomInt(min, max).toString();
  }

  async createOtp(
    identifier: string,
    type: TokenType = TokenType.OTP,
    expiresInMinutes: number = 10,
    length: number = 6,
  ): Promise<string> {
    const record = await this.createOtpRecord(identifier, type, expiresInMinutes, length);
    return record.token;
  }

  // Resends reuse an unexpired code, so delayed or reordered emails remain valid.
  async getOrCreateVerificationOtp(identifier: string) {
    const email = identifier.trim().toLowerCase();
    const existing = this.verificationRequests.get(email);
    if (existing) return existing;
    const request = (async () => {
      const active = await this.prisma.otpToken.findFirst({
        where: { identifier: email, type: TokenType.EMAIL_VERIFICATION, isUsed: false,
          expiresAt: { gt: DateUtil.addMinutes(new Date(), 1) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, token: true, expiresAt: true },
      });
      return active || this.createOtpRecord(email, TokenType.EMAIL_VERIFICATION, 15, 6);
    })();
    this.verificationRequests.set(email, request);
    try { return await request; }
    finally { this.verificationRequests.delete(email); }
  }

  private async createOtpRecord(identifier: string, type: TokenType, expiresInMinutes: number, length: number) {
    const token = this.generateNumericOtp(length);
    const expiresAt = DateUtil.addMinutes(new Date(), expiresInMinutes);

    // Invalidate prior unused tokens of the same type for this identifier
    await this.prisma.otpToken.updateMany({
      where: {
        identifier,
        type,
        isUsed: false,
      },
      data: {
        isUsed: true,
      },
    });

    const record = await this.prisma.otpToken.create({
      data: {
        identifier,
        token,
        type,
        expiresAt,
      },
    });

    this.logger.log(`Created OTP for identifier: ${identifier}, type: ${type}`);
    return record;
  }

  async verifyOtp(
    identifier: string,
    token: string,
    type: TokenType = TokenType.OTP,
  ): Promise<boolean> {
    const record = await this.prisma.otpToken.findFirst({
      where: {
        identifier,
        token,
        type,
        isUsed: false,
        expiresAt: {
          gte: new Date(),
        },
      },
    });

    if (!record) {
      return false;
    }

    // Mark as used
    await this.prisma.otpToken.update({
      where: { id: record.id },
      data: { isUsed: true },
    });

    this.logger.log(`Verified OTP for identifier: ${identifier}`);
    return true;
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.prisma.otpToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }
}
