import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly fromAddress: string;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_key');
    this.fromAddress = 'United Union eSIM <onboarding@resend.dev>';
  }

  private async sendEmail(
    toEmail: string,
    subject: string,
    htmlContent: string,
  ): Promise<void> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: [toEmail],
        subject,
        html: htmlContent,
      });

      if (error) {
        this.logger.error(
          `[Resend API Error] ${error.name}: ${error.message}`,
        );
      } else {
        this.logger.log(
          `[Resend Email Sent] id=${data?.id} "${subject}" to ${toEmail}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Resend Send Exception] ${(err as Error).message}`,
      );
    }
  }

  async sendEmailVerification(email: string, otpCode: string): Promise<void> {
    this.logger.log(
      `[MailService] Sending 6-digit OTP email verification to ${email} (OTP: ${otpCode})`,
    );

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #1e63ff; margin: 0;">United Union eSIM</h2>
          <p style="color: #666666; font-size: 14px;">Email Verification Code</p>
        </div>
        <div style="background-color: #f4f7ff; padding: 24px; border-radius: 12px; text-align: center; margin: 20px 0;">
          <p style="font-size: 14px; color: #444444; margin-bottom: 8px;">Your 6-digit verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e63ff; margin: 12px 0;">${otpCode}</div>
          <p style="font-size: 12px; color: #888888; margin-top: 8px;">This code is valid for 15 minutes. Please do not share this code with anyone.</p>
        </div>
        <p style="font-size: 13px; color: #666666; line-height: 1.5;">If you did not request this code, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eeeeee; margin: 20px 0;" />
        <p style="font-size: 11px; color: #aaaaaa; text-align: center;">&copy; ${new Date().getFullYear()} United Union eSIM. All rights reserved.</p>
      </div>
    `;

    await this.sendEmail(
      email,
      `${otpCode} is your United Union eSIM verification code`,
      htmlContent,
    );
  }

  async sendPasswordReset(email: string, otpOrToken: string): Promise<void> {
    this.logger.log(`[MailService] Sending password reset email to ${email}`);

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px;">
        <h2 style="color: #1e63ff;">Password Reset Request</h2>
        <p>You requested a password reset for your United Union eSIM account.</p>
        <div style="background-color: #f4f7ff; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="font-size: 14px; color: #444;">Your security verification token:</p>
          <div style="font-size: 24px; font-weight: bold; color: #1e63ff; font-family: monospace;">${otpOrToken}</div>
        </div>
        <p style="font-size: 12px; color: #888;">If you did not request this, please secure your account immediately.</p>
      </div>
    `;

    await this.sendEmail(
      email,
      `Reset Your United Union Password`,
      htmlContent,
    );
  }

  async sendEsimDetails(
    email: string,
    iccid: string,
    qrCodeUrl: string,
    smDpAddress: string,
    activationCode: string,
  ): Promise<void> {
    this.logger.log(
      `[MailService] Sending eSIM activation details email to ${email}`,
    );

    const lpaString = `LPA:1$${smDpAddress}$${activationCode}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
        <div style="text-align: center; padding-bottom: 16px; border-bottom: 1px solid #f1f5f9;">
          <h1 style="color: #1e63ff; margin: 0; font-size: 24px;">United Union eSIM</h1>
          <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Your Travel Cellular Profile is Ready!</p>
        </div>

        <div style="padding: 20px 0; text-align: center;">
          <p style="font-size: 14px; color: #334155; margin-bottom: 16px;">Scan the QR code below on your phone to install your eSIM:</p>
          <div style="display: inline-block; padding: 12px; border: 1px solid #cbd5e1; border-radius: 16px; background: #ffffff;">
            <img src="${qrCodeUrl}" alt="eSIM QR Code" style="width: 180px; height: 180px; display: block;" />
          </div>
        </div>

        <div style="background-color: #f8fafc; padding: 16px; border-radius: 12px; margin-bottom: 20px;">
          <h3 style="font-size: 13px; color: #1e293b; margin-top: 0; text-transform: uppercase; letter-spacing: 0.5px;">Manual Activation Details</h3>
          <table style="width: 100%; font-size: 12px; color: #475569; border-collapse: collapse;">
            <tr>
              <td style="padding: 4px 0; font-weight: bold; width: 120px;">ICCID:</td>
              <td style="padding: 4px 0; font-family: monospace;">${iccid}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">SM-DP+ Address:</td>
              <td style="padding: 4px 0; font-family: monospace;">${smDpAddress}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Activation Code:</td>
              <td style="padding: 4px 0; font-family: monospace;">${activationCode}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">LPA String:</td>
              <td style="padding: 4px 0; font-family: monospace; word-break: break-all;">${lpaString}</td>
            </tr>
          </table>
        </div>

        <div style="font-size: 12px; color: #64748b; line-height: 1.6;">
          <h4 style="margin: 0 0 8px 0; color: #1e293b;">Quick Installation Steps:</h4>
          <p style="margin: 4px 0;"><strong>iOS:</strong> Settings &gt; Cellular &gt; Add eSIM &gt; Scan QR Code</p>
          <p style="margin: 4px 0;"><strong>Android:</strong> Settings &gt; Network &amp; Internet &gt; SIMs (+) &gt; Add eSIM</p>
        </div>

        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
        <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">&copy; ${new Date().getFullYear()} United Union eSIM. Safe Travels!</p>
      </div>
    `;

    await this.sendEmail(
      email,
      `Your United Union eSIM Profile Credentials`,
      htmlContent,
    );
  }
}
