const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

test('relay rejects unauthorized and invalid requests and awaits SMTP delivery', async () => {
  const previous = { ...process.env };
  const original = nodemailer.createTransport;
  let delivered;
  nodemailer.createTransport = () => ({ sendMail: async (mail) => { delivered = mail; return { accepted: [mail.to] }; } });
  process.env.EMAIL_RELAY_SECRET = 'test-secret';
  process.env.SMTP_USER = 'sender@example.com';
  process.env.SMTP_PASS = 'test-password';
  const handler = require('../api/email-relay');
  const call = async (req) => {
    const response = {
      code: 0,
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler(req, response);
    return response;
  };
  try {
    assert.equal((await call({ method: 'GET' })).code, 405);
    assert.equal((await call({ method: 'POST', headers: {} })).code, 401);
    const req = { method: 'POST', headers: { authorization: 'Bearer test-secret' } };
    assert.equal((await call({ ...req, body: '{' })).code, 400);
    assert.equal((await call({ ...req, body: { to: 'bad', subject: 'OTP', text: 'code' } })).code, 400);
    assert.equal(delivered, undefined);
    const result = await call({ ...req, body: { to: 'user@example.com', subject: 'Verification', text: 'test code', from: 'attacker@example.com' } });
    assert.equal(result.code, 200);
    assert.equal(result.body.success, true);
    assert.equal(delivered.to, 'user@example.com');
    assert.equal(delivered.from.name, 'Plush Massenger');
    assert.equal(delivered.from.address, process.env.EMAIL_SENDER_SMTP_FROM || process.env.SMTP_FROM_EMAIL || process.env.EMAIL_SENDER_SMTP_USER || 'sender@example.com');
  } finally {
    nodemailer.createTransport = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
