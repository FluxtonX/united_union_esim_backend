import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendEmailVerification(email: string, rawToken: string): Promise<void> {
    this.logger.log(`[MailService] Sending verification email to ${email}`);
    // In production, integrate with Resend API:
    // resend.emails.send({ from: 'no-reply@unitedunion.com', to: email, ... })
    this.logger.log(`[MailService] Raw verification token: ${rawToken}`);
  }

  async sendPasswordReset(email: string, rawToken: string): Promise<void> {
    this.logger.log(`[MailService] Sending password reset link to ${email}`);
    // In production, send: https://unitedunion.com/reset-password?token=rawToken
    this.logger.log(`[MailService] Raw reset token: ${rawToken}`);
  }

  async sendEsimDetails(
    email: string,
    iccid: string,
    qrCodeUrl: string,
    smDpAddress: string,
    activationCode: string,
  ): Promise<void> {
    this.logger.log(`[MailService] Sending eSIM details email to ${email}`);
    this.logger.log(`[MailService] ICCID: ${iccid}`);
    this.logger.log(`[MailService] SM-DP+ Address: ${smDpAddress}`);
    this.logger.log(`[MailService] Activation Code: ${activationCode}`);
    this.logger.log(`[MailService] QR Code LPA Link: ${qrCodeUrl}`);
  }
}
