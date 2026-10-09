import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter!: nodemailer.Transporter;
  private readonly templates = new Map<string, ejs.TemplateFunction>();

  constructor() {
    this.initTransporter();
  }

  private initTransporter() {
    const host = process.env.EMAIL_SENDER_SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.EMAIL_SENDER_SMTP_PORT || process.env.SMTP_PORT || '465', 10);
    const user = process.env.EMAIL_SENDER_SMTP_USER || process.env.SMTP_USER;
    const pass = process.env.EMAIL_SENDER_SMTP_PASS || process.env.SMTP_PASS;
    const isSecure = port === 465 || process.env.SMTP_SECURE === 'true';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: {
        user,
        pass,
      },
    });
  }

  async verifyTransport() {
    try {
      const user = process.env.EMAIL_SENDER_SMTP_USER || process.env.SMTP_USER;
      const pass = process.env.EMAIL_SENDER_SMTP_PASS || process.env.SMTP_PASS;

      if (user && pass && user !== 'test@example.com') {
        await this.transporter.verify();
        this.logger.log('📧 SMTP transporter verified successfully');
      } else {
        this.logger.warn('📧 SMTP transporter initialized in test/mock mode');
      }
    } catch (error) {
      this.logger.warn(`⚠️ SMTP connection verification failed: ${(error as any)?.message}`);
    }
  }

  async sendMail(options: SendMailOptions): Promise<boolean> {
    const fromName = 'Plush Massenger';
    const fromEmail =
      process.env.EMAIL_SENDER_SMTP_FROM ||
      process.env.SMTP_FROM_EMAIL ||
      process.env.EMAIL_SENDER_SMTP_USER ||
      'no-reply@example.com';

    try {
      if (process.env.NODE_ENV === 'test') {
        this.logger.debug(`[Mock Email] To: ${options.to}, Subject: ${options.subject}`);
        return true;
      }

      // Render remains the primary backend; only email delivery uses Vercel.
      if (process.env.EMAIL_RELAY_URL && !process.env.VERCEL) {
        if (!process.env.EMAIL_RELAY_SECRET) throw new Error('EMAIL_RELAY_SECRET is required');
        const response = await fetch(process.env.EMAIL_RELAY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.EMAIL_RELAY_SECRET}`,
          },
          body: JSON.stringify(options),
          signal: AbortSignal.timeout(15000),
        });
        const result = await response.json() as { success?: boolean; error?: string };
        if (!response.ok) {
          const knownErrors = ['RELAY_NOT_CONFIGURED', 'SMTP_NOT_CONFIGURED', 'RECIPIENT_REJECTED', 'SMTP_DELIVERY_FAILED'];
          const reason = knownErrors.includes(result.error || '') ? result.error : 'RELAY_REQUEST_FAILED';
          throw new Error(`Email relay failed (${response.status}): ${reason}`);
        }
        return result.success === true;
      }

      await this.transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      this.logger.log(`Email sent successfully to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}`, error);
      return false;
    }
  }

  async renderTemplate(templateName: string, data: Record<string, any>): Promise<string> {
    const cached = this.templates.get(templateName);
    if (cached) return cached({ ...data, appName: 'Plush Massenger' });
    const candidatePaths = [
      path.join(process.cwd(), 'src', 'app', 'templates', `${templateName}.ejs`),
      path.join(process.cwd(), 'dist', 'app', 'templates', `${templateName}.ejs`),
      path.join(__dirname, '..', '..', 'templates', `${templateName}.ejs`),
      path.join(__dirname, '..', 'templates', `${templateName}.ejs`),
    ];

    const templatePath = candidatePaths.find((p) => fs.existsSync(p));

    if (!templatePath) {
      this.logger.warn(`Template ${templateName}.ejs not found on disk, using fallback inline renderer.`);
      throw new Error(`Email template not found: ${templateName}`);
    }

    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    const template = ejs.compile(templateContent);
    this.templates.set(templateName, template);
    return template({
      ...data,
      appName: 'Plush Massenger',
    });
  }

  async sendOtpEmail(to: string, otp: string, userName?: string, expiresInMinutes = 15): Promise<boolean> {
    const html = await this.renderTemplate('otp', {
      otp,
      userName,
      expiresInMinutes,
    });

    return this.sendMail({
      to,
      subject: 'Your Plush Massenger verification code',
      html,
      text: `Plush Massenger\n\nYour verification code is: ${otp}. It expires in ${expiresInMinutes} minutes.\n\nDo not share this code with anyone. If you did not request it, you can ignore this email.`,
    });
  }

  async sendVerificationEmail(to: string, verificationUrl: string, userName?: string): Promise<boolean> {
    const html = await this.renderTemplate('verify-email', {
      verificationUrl,
      userName,
    });

    return this.sendMail({
      to,
      subject: 'Verify your email address',
      html,
      text: `Please verify your email address by opening this link: ${verificationUrl}`,
    });
  }

  async sendPasswordResetEmail(to: string, resetUrl: string, userName?: string): Promise<boolean> {
    const html = await this.renderTemplate('reset-password', {
      resetUrl,
      userName,
    });

    return this.sendMail({
      to,
      subject: 'Password Reset Request',
      html,
      text: `Reset your password by following this link: ${resetUrl}`,
    });
  }
}
