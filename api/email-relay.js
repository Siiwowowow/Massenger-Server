const { timingSafeEqual } = require('node:crypto');
const nodemailer = require('nodemailer');

let transporter;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false });
  }
  const secret = process.env.EMAIL_RELAY_SECRET;
  if (!secret) {
    console.error('Email relay configuration missing: EMAIL_RELAY_SECRET');
    return res.status(503).json({ success: false, error: 'RELAY_NOT_CONFIGURED' });
  }
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ success: false });
  }
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ success: false });
  }
  if (!body || typeof body.to !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(body.to)
    || typeof body.subject !== 'string' || body.subject.length > 200
    || /[\r\n]/.test(body.subject)
    || !['html', 'text'].some((key) => typeof body[key] === 'string' && body[key].length > 0)
    || ['html', 'text'].some((key) => body[key] != null && (typeof body[key] !== 'string' || body[key].length > 100000))) {
    return res.status(400).json({ success: false });
  }
  const user = process.env.EMAIL_SENDER_SMTP_USER || process.env.SMTP_USER;
  const pass = process.env.EMAIL_SENDER_SMTP_PASS || process.env.SMTP_PASS;
  if (!user || !pass) {
    console.error('Email relay SMTP credentials are missing');
    return res.status(503).json({ success: false, error: 'SMTP_NOT_CONFIGURED' });
  }
  try {
    if (!transporter) {
      const port = Number(process.env.EMAIL_SENDER_SMTP_PORT || process.env.SMTP_PORT || 465);
      transporter = nodemailer.createTransport({
        host: process.env.EMAIL_SENDER_SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: port === 465 || process.env.SMTP_SECURE === 'true',
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        auth: { user, pass },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
    }
    const delivery = await transporter.sendMail({
      from: {
        name: 'Plush Massenger',
        address: process.env.EMAIL_SENDER_SMTP_FROM || process.env.SMTP_FROM_EMAIL || user,
      },
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });
    if (!delivery.accepted?.length) {
      return res.status(502).json({ success: false, error: 'RECIPIENT_REJECTED' });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    // Log diagnostic codes only; SMTP error messages can contain recipient data.
    console.error('Email relay delivery failed', {
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
    });
    return res.status(502).json({ success: false, error: 'SMTP_DELIVERY_FAILED' });
  }
};
