import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from './email.service';
import { VerificationEmailDelivery } from '../../../generated/prisma';

@Injectable()
export class VerificationEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VerificationEmailService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  async onModuleInit() {
    // MongoDB needs no table migration; ensure only this new collection's indexes.
    await this.prisma.$runCommandRaw({
      createIndexes: 'verification_email_deliveries',
      indexes: [
        { key: { otpId: 1 }, name: 'verification_email_deliveries_otpId_key', unique: true },
        { key: { status: 1, nextAttemptAt: 1 }, name: 'verification_email_deliveries_status_nextAttemptAt_idx' },
        { key: { identifier: 1, createdAt: 1 }, name: 'verification_email_deliveries_identifier_createdAt_idx' },
      ],
    });
    if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => this.wake(), 3000);
      this.timer.unref();
      this.wake();
    }
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async enqueue(identifier: string, otpId: string, userName?: string) {
    let job: VerificationEmailDelivery;
    try {
      job = await this.prisma.verificationEmailDelivery.upsert({
        where: { otpId }, update: {}, create: { identifier, otpId, userName },
      });
    } catch (error) {
      // MongoDB upserts can race across instances. The unique index selects the
      // winner; the other request reuses the durable job instead of failing.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const existing = await this.prisma.verificationEmailDelivery.findUnique({ where: { otpId } });
      if (!existing) throw error;
      job = existing;
    }
    // Keep concurrent clicks idempotent and allow a genuine resend after 30s.
    if (job.status === 'FAILED' || (job.status === 'SENT' && job.sentAt
      && Date.now() - job.sentAt.getTime() >= 30000)) {
      await this.prisma.verificationEmailDelivery.updateMany({
        where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() },
      });
      job = (await this.prisma.verificationEmailDelivery.findUnique({ where: { otpId } }))!;
    }
    // A long-lived Render worker can finish after the HTTP response. Vercel must
    // await delivery within the function lifetime; the durable row survives failure.
    if (process.env.VERCEL) {
      await this.deliver(job);
      job = (await this.prisma.verificationEmailDelivery.findUnique({ where: { otpId } }))!;
    }
    else this.wake();
    return { verificationEmailQueued: job.status !== 'SENT', retryAfter: 30 };
  }

  async getStatus(identifier: string) {
    // Serverless fallback retries while a status request keeps the function
    // alive. The primary Render deployment normally runs its own timer.
    if (process.env.VERCEL) await this.drain();
    const job = await this.prisma.verificationEmailDelivery.findFirst({
      where: { identifier }, orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    // UNKNOWN also supports clients talking to an older deployment.
    return { status: job?.status || 'UNKNOWN' };
  }

  private wake() {
    void this.drain().catch(() => this.logger.error('Verification email worker will retry on its next tick'));
  }

  async drain(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.processBatch();
    try { await this.running; } finally { this.running = undefined; }
  }

  private async processBatch() {
    const now = new Date();
    const jobs = await this.prisma.verificationEmailDelivery.findMany({
      where: { OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', lockedUntil: { lte: now } },
      ] },
      orderBy: { nextAttemptAt: 'asc' }, take: 3,
    });
    await Promise.all(jobs.map((job) => this.deliver(job)));
  }

  private async deliver(job: VerificationEmailDelivery) {
    const now = new Date();
    const lease = new Date(now.getTime() + 60000);
    const claim = await this.prisma.verificationEmailDelivery.updateMany({
      where: { id: job.id, OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', lockedUntil: { lte: now } },
      ] },
      data: { status: 'PROCESSING', lockedUntil: lease, attempts: { increment: 1 } },
    });
    if (!claim.count) return;
    const where = { id: job.id, status: 'PROCESSING', lockedUntil: lease };
    try {
      const otp = await this.prisma.otpToken.findUnique({ where: { id: job.otpId } });
      if (!otp || otp.isUsed || otp.expiresAt <= now) {
        await this.prisma.verificationEmailDelivery.updateMany({ where, data: { status: 'CANCELLED' } });
        return;
      }
      const sent = await this.email.sendOtpEmail(job.identifier, otp.token, job.userName || undefined,
        Math.max(1, Math.ceil((otp.expiresAt.getTime() - now.getTime()) / 60000)));
      if (!sent) throw new Error('DELIVERY_FAILED');
      await this.prisma.verificationEmailDelivery.updateMany({ where,
        data: { status: 'SENT', sentAt: new Date() } });
    } catch {
      const attempt = job.attempts + 1;
      const delay = Math.min(30000, 2000 * 2 ** (attempt - 1));
      await this.prisma.verificationEmailDelivery.updateMany({ where,
        data: { status: attempt >= 5 ? 'FAILED' : 'PENDING', nextAttemptAt: new Date(Date.now() + delay) } });
      this.logger.warn(`Verification delivery attempt ${attempt} failed; ${attempt >= 5 ? 'resend required' : 'retry scheduled'}`);
    }
  }
}
