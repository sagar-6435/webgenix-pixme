import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { escapeHtml } from '../common/utils/crypto.util';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter!: Transporter;
  private from!: string;
  private transportMode!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.from = this.config.get<string>('mail.from') ?? 'Pixme <contact@pixme.app>';
    this.transportMode = this.config.get<string>('mail.transport') ?? 'console';

    if (this.transportMode === 'smtp') {
      const port = this.config.get<number>('mail.smtpPort') ?? 587;
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('mail.smtpHost'),
        port,
        secure: this.config.get<boolean>('mail.smtpSecure') ?? port === 465,
        auth: this.config.get<string>('mail.smtpUser')
          ? {
              user: this.config.get<string>('mail.smtpUser'),
              pass: this.config.get<string>('mail.smtpPassword'),
            }
          : undefined,
      });
    } else {
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      this.logger.warn('Mail transport is "console" — emails are logged, not delivered');
    }
  }

  private layout(title: string, body: string, cta?: { label: string; url: string }): string {
    return `<!doctype html>
<html><body style="margin:0;background:#f6f3ee;font-family:Inter,Arial,sans-serif;color:#17151a">
  <div style="max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e2d9;border-radius:20px;overflow:hidden">
    <div style="padding:28px 32px;border-bottom:1px solid #eee8df">
      <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em">pixme<span style="color:#ff5a36">.</span></span>
    </div>
    <div style="padding:36px 32px">
      <h1 style="font-size:24px;line-height:1.2;margin:0 0 16px">${escapeHtml(title)}</h1>
      <div style="font-size:15px;line-height:1.7;color:#5b5660">${body}</div>
      ${
        cta
          ? `<a href="${escapeHtml(cta.url)}" style="display:inline-block;margin-top:24px;background:#17151a;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;font-size:14px">${escapeHtml(cta.label)}</a>
             <p style="font-size:12px;color:#8d8792;margin-top:20px">Or paste this link into your browser:<br><a href="${escapeHtml(cta.url)}" style="color:#ff5a36;word-break:break-all">${escapeHtml(cta.url)}</a></p>`
          : ''
      }
    </div>
    <div style="padding:20px 32px;border-top:1px solid #eee8df;font-size:12px;color:#8d8792">
      Pixme · Private event galleries, found by face.<br>
      We only use biometric data for the event you choose, with your explicit consent.
    </div>
  </div>
</body></html>`;
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      const info = await this.transporter.sendMail({ from: this.from, to, subject, html });
      if (this.transportMode === 'console') {
        this.logger.log(`[mail:console] to=${to} subject="${subject}"`);
        if ('message' in info && typeof info.message === 'string') {
          this.logger.debug(info.message.slice(0, 500));
        }
      }
    } catch (error) {
      this.logger.error(`Email delivery failed to ${to}: ${(error as Error).message}`);
    }
  }

  async sendVerification(to: string, name: string, token: string): Promise<void> {
    const url = `${this.config.getOrThrow<string>('appUrl')}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Verify your Pixme account',
      this.layout(
        `Welcome to Pixme, ${escapeHtml(name)}`,
        'Confirm your email address to start creating private, AI-powered event galleries. This link expires in 24 hours.',
        { label: 'Verify my email', url },
      ),
    );
  }

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const url = `${this.config.getOrThrow<string>('appUrl')}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Reset your Pixme password',
      this.layout(
        'Reset your password',
        `Hi ${escapeHtml(name)}, we received a request to reset your Pixme password. This link expires in 30 minutes. If you did not ask for this, you can safely ignore this email.`,
        { label: 'Choose a new password', url },
      ),
    );
  }

  async sendStudioInvite(
    to: string,
    studioName: string,
    inviterName: string,
    token: string,
  ): Promise<void> {
    const url = `${this.config.getOrThrow<string>('appUrl')}/accept-invite?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      `You're invited to ${studioName} on Pixme`,
      this.layout(
        `Join ${escapeHtml(studioName)}`,
        `${escapeHtml(inviterName)} invited you to collaborate on Pixme. Accept the invitation to create your account and access the studio. This invitation expires in 7 days.`,
        { label: 'Accept invitation', url },
      ),
    );
  }
}
