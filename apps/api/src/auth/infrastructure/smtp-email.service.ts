import type { AppConfig } from '@janus/config';
import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../../app.tokens';
import type { EmailService } from '../domain/auth.ports';

@Injectable()
export class SmtpEmailService implements EmailService {
  private readonly transporter: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
    });
  }

  async sendVerificationCode(input: { to: string; username: string; code: string }): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.SMTP_FROM,
      to: input.to,
      subject: 'Verify your Janus Protect account',
      text: `Hello ${input.username},\n\nYour verification code is ${input.code}. It expires in 15 minutes.\n\nIf you did not create this account, you can ignore this email.`,
    });
  }

  async sendPasswordReset(input: { to: string; username: string; token: string }): Promise<void> {
    const resetUrl = `${this.config.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(input.token)}`;
    await this.transporter.sendMail({
      from: this.config.SMTP_FROM,
      to: input.to,
      subject: 'Reset your Janus Protect password',
      text: `Hello ${input.username},\n\nReset your password using this link:\n${resetUrl}\n\nThe link expires in 30 minutes. If you did not request it, you can ignore this email.`,
    });
  }
}
