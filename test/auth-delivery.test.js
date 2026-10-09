require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VerificationEmailService } = require('../dist/app/infrastructure/email/verification-email.service');
const { OtpService } = require('../dist/app/shared/otp/otp.service');
const { AuthService } = require('../dist/app/auth/auth.service');
const { getAuth } = require('../dist/app/auth/better-auth.instance');

const otpId = '111111111111111111111111';
function matches(row, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return expected.some((part) => matches(row, part));
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('lte' in expected) return row[key] <= expected.lte;
    }
    return row[key] instanceof Date && expected instanceof Date
      ? row[key].getTime() === expected.getTime() : row[key] === expected;
  });
}
function database() {
  const jobs = [];
  const otp = { id: otpId, token: '123456', isUsed: false, expiresAt: new Date(Date.now() + 900000) };
  const prisma = {
    user: { findUnique: async () => null },
    otpToken: { findUnique: async () => otp },
    verificationEmailDelivery: {
      upsert: async ({ where, create }) => {
        let job = jobs.find((value) => value.otpId === where.otpId);
        if (!job) {
          job = { ...create, id: '222222222222222222222222', status: 'PENDING', attempts: 0,
            nextAttemptAt: new Date(), lockedUntil: new Date(), sentAt: null, createdAt: new Date(), updatedAt: new Date() };
          jobs.push(job);
        }
        return { ...job };
      },
      findUnique: async ({ where }) => ({ ...jobs.find((job) => matches(job, where)) }),
      findMany: async ({ where, take }) => jobs.filter((job) => matches(job, where)).slice(0, take).map((job) => ({ ...job })),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const job of jobs) if (matches(job, where)) {
          count++;
          for (const [key, value] of Object.entries(data)) job[key] = value && typeof value === 'object' && 'increment' in value
            ? job[key] + value.increment : value;
          job.updatedAt = new Date();
        }
        return { count };
      },
    },
  };
  return { prisma, jobs, otp };
}

test('registration saves a durable email job and returns while SMTP is still pending', async () => {
  const { prisma, jobs } = database();
  let finish, started = false;
  const email = { sendOtpEmail: async () => { started = true; return new Promise((resolve) => { finish = resolve; }); } };
  const worker = new VerificationEmailService(prisma, email);
  const instance = await getAuth(prisma);
  const original = instance.api.signUpEmail;
  instance.api.signUpEmail = async () => ({ user: { id: otpId, email: 'user@example.com', name: 'User' } });
  try {
    const service = new AuthService(prisma, email, { getOrCreateVerificationOtp: async () => ({ id: otpId }) }, {}, worker);
    const result = await service.register({ email: 'user@example.com', name: 'User', password: 'password123' });
    assert.equal(result.verificationEmailQueued, true);
    assert.equal(jobs.length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, true);
    assert.equal(jobs[0].status, 'PROCESSING');
    finish(true);
    await worker.drain();
    assert.equal(jobs[0].status, 'SENT');
  } finally { instance.api.signUpEmail = original; }
});

test('failed email retries from persistent state, including after a worker restart', async () => {
  const { prisma, jobs } = database();
  const first = new VerificationEmailService(prisma, { sendOtpEmail: async () => false });
  await first.enqueue('user@example.com', otpId, 'User');
  await first.drain();
  assert.equal(jobs[0].status, 'PENDING');
  assert.equal(jobs[0].attempts, 1);
  jobs[0].nextAttemptAt = new Date(0);
  const restarted = new VerificationEmailService(prisma, { sendOtpEmail: async () => true });
  await restarted.drain();
  assert.equal(jobs[0].status, 'SENT');
  assert.equal(jobs[0].attempts, 2);
});

test('two workers atomically claim one job and recover an expired processing lease', async () => {
  const { prisma, jobs } = database();
  let sends = 0;
  const email = { sendOtpEmail: async () => { sends++; return true; } };
  await prisma.verificationEmailDelivery.upsert({ where: { otpId }, create: { otpId, identifier: 'user@example.com' } });
  jobs[0].status = 'PROCESSING'; jobs[0].lockedUntil = new Date(0);
  await Promise.all([new VerificationEmailService(prisma, email).drain(), new VerificationEmailService(prisma, email).drain()]);
  assert.equal(sends, 1);
  assert.equal(jobs[0].status, 'SENT');
});

test('resend keeps a valid code and deduplicates concurrent generation', async () => {
  let created = 0;
  const active = { id: otpId, token: '123456', expiresAt: new Date(Date.now() + 900000) };
  const service = new OtpService({ otpToken: { findFirst: async () => active,
    create: async () => { created++; }, updateMany: async () => { throw new Error('valid OTP must not be invalidated'); } } });
  const [a, b] = await Promise.all([service.getOrCreateVerificationOtp('USER@example.com'), service.getOrCreateVerificationOtp('user@example.com')]);
  assert.equal(a.token, active.token); assert.equal(b.id, active.id); assert.equal(created, 0);
});

test('resend cooldown does not send duplicate email, then permits a resend of the same code', async () => {
  const { prisma, jobs } = database();
  let sends = 0;
  const worker = new VerificationEmailService(prisma, { sendOtpEmail: async (_to, code) => { sends++; assert.equal(code, '123456'); return true; } });
  await worker.enqueue('user@example.com', otpId, 'User'); await worker.drain();
  await worker.enqueue('user@example.com', otpId, 'User'); await worker.drain();
  assert.equal(sends, 1);
  jobs[0].sentAt = new Date(Date.now() - 31000);
  await worker.enqueue('user@example.com', otpId, 'User'); await worker.drain();
  assert.equal(sends, 2); assert.equal(jobs.length, 1);
});

test('a used verification code is never emailed by a delayed retry', async () => {
  const { prisma, jobs, otp } = database(); otp.isUsed = true;
  const worker = new VerificationEmailService(prisma, { sendOtpEmail: async () => { throw new Error('must not send'); } });
  await worker.enqueue('user@example.com', otpId, 'User'); await worker.drain();
  assert.equal(jobs[0].status, 'CANCELLED');
});

test('email failures stop after five attempts and a manual resend restarts delivery', async () => {
  const { prisma, jobs } = database();
  const worker = new VerificationEmailService(prisma, { sendOtpEmail: async () => false });
  await worker.enqueue('user@example.com', otpId, 'User'); await worker.drain();
  for (let i = 0; i < 4; i++) { jobs[0].nextAttemptAt = new Date(0); await worker.drain(); }
  assert.equal(jobs[0].status, 'FAILED'); assert.equal(jobs[0].attempts, 5);
  const recovering = new VerificationEmailService(prisma, { sendOtpEmail: async () => true });
  await recovering.enqueue('user@example.com', otpId, 'User'); await recovering.drain();
  assert.equal(jobs[0].status, 'SENT'); assert.equal(jobs[0].attempts, 1);
});

test('Vercel fallback awaits SMTP within the function lifetime', async () => {
  const previous = process.env.VERCEL; process.env.VERCEL = '1';
  const { prisma, jobs } = database();
  let finish, completed = false;
  const worker = new VerificationEmailService(prisma, {
    sendOtpEmail: async () => new Promise((resolve) => { finish = resolve; }),
  });
  try {
    const queued = worker.enqueue('user@example.com', otpId, 'User').then((result) => { completed = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, false); assert.equal(jobs[0].status, 'PROCESSING');
    finish(true);
    assert.equal((await queued).verificationEmailQueued, false);
    assert.equal(jobs[0].status, 'SENT');
  } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});
