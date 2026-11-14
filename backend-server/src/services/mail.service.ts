import nodemailer from 'nodemailer';
import { ENV } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

export class MailService {
  static isConfigured(): boolean {
    return Boolean(ENV.SMTP_HOST && ENV.SMTP_FROM);
  }

  /**
   * Send mail when SMTP is configured. Otherwise log the message so local demos still work.
   */
  static async send(to: string, subject: string, text: string): Promise<{ delivered: boolean }> {
    if (!this.isConfigured()) {
      logger.info(`[MailService] SMTP not configured. Would send to ${to}: ${subject}\n${text}`);
      return { delivered: false };
    }

    const transporter = nodemailer.createTransport({
      host: ENV.SMTP_HOST,
      port: ENV.SMTP_PORT,
      secure: ENV.SMTP_SECURE,
      auth: ENV.SMTP_USER
        ? {
            user: ENV.SMTP_USER,
            pass: ENV.SMTP_PASS
          }
        : undefined
    });

    await transporter.sendMail({
      from: ENV.SMTP_FROM,
      to,
      subject,
      text
    });

    return { delivered: true };
  }
}
