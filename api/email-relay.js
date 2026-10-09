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
  if (!secret) return res.status(503).json({ success: false });
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
  if (!user || !pass) return res.status(503).json({ success: false });
  try {
    if (!transporter) {
      const port = Number(process.env.EMAIL_SENDER_SMTP_PORT || process.env.SMTP_PORT || 465);
      transporter = nodemailer.createTransport({
        host: process.env.EMAIL_SENDER_SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: port === 465 || process.env.SMTP_SECURE === 'true',
        auth: { user, pass },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
    }
    await transporter.sendMail({
      from: {
        name: process.env.SMTP_FROM_NAME || 'Pulse Messenger',
        address: process.env.EMAIL_SENDER_SMTP_FROM || process.env.SMTP_FROM_EMAIL || user,
      },
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });
    return res.status(200).json({ success: true });
  } catch {
    console.error('Email relay delivery failed');
    return res.status(502).json({ success: false });
  }
};
