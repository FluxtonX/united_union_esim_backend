import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  ESIM_PROVIDER,
  EsimProvider,
} from '../providers/interfaces/esim-provider.interface';
import { MailService } from '../mail/mail.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class EsimProvisionService {
  private readonly logger = new Logger(EsimProvisionService.name);
  private readonly provider: EsimProvider;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ESIM_PROVIDER) provider: any,
    private readonly mailService: MailService,
  ) {
    this.provider = provider as EsimProvider;
  }

  async provision(
    orderId: string,
    planId: string,
    email: string,
    targetIccid?: string,
  ): Promise<void> {
    this.logger.log(
      `[EsimProvisionService] Starting provisioning for Order: ${orderId}${
        targetIccid ? ` (Top-up ICCID: ${targetIccid})` : ''
      }`,
    );

    const order = await this.prisma.esimOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      this.logger.error(
        `Order ${orderId} not found in database. Terminating provisioning.`,
      );
      return;
    }

    if (order.status !== OrderStatus.PENDING) {
      this.logger.warn(
        `Order ${orderId} is already processed (Status: ${order.status}). Skipping.`,
      );
      return;
    }

    try {
      if (targetIccid) {
        // 1. Perform Top-up for existing eSIM
        const providerOrder = await this.provider.topupEsim(targetIccid, planId);

        // Find existing eSIM profile
        let profile = await this.prisma.esimProfile.findUnique({
          where: { iccid: targetIccid },
        });

        if (!profile) {
          throw new Error(`eSIM profile for ICCID ${targetIccid} not found in database.`);
        }

        // Link order to existing profile and mark PROVISIONED
        await this.prisma.esimOrder.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.PROVISIONED,
            esimProfileId: profile.id,
          },
        });

        // Touch the profile updatedAt
        await this.prisma.esimProfile.update({
          where: { id: profile.id },
          data: { updatedAt: new Date() },
        });

        this.logger.log(
          `Order ${orderId} successfully provisioned as top-up on ICCID: ${targetIccid}`,
        );

        // Email top-up confirmation to the user
        await this.mailService.sendEsimDetails(
          email,
          targetIccid,
          profile.qrCodeUrl,
          profile.smDpAddress,
          profile.activationCode,
        );
      } else {
        // 2. Provision new eSIM
        const providerOrder = await this.provider.orderEsim(planId, email);

        // Create new eSIM profile in database
        const profile = await this.prisma.esimProfile.create({
          data: {
            userId: order.userId,
            iccid: providerOrder.iccid,
            qrCodeUrl: providerOrder.qrCodeUrl,
            smDpAddress: providerOrder.smDpAddress,
            activationCode: providerOrder.activationCode,
            status: 'active',
          },
        });

        // Update database order to PROVISIONED and link to new profile
        await this.prisma.esimOrder.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.PROVISIONED,
            esimProfileId: profile.id,
          },
        });

        this.logger.log(
          `Order ${orderId} successfully provisioned with new ICCID: ${providerOrder.iccid}`,
        );

        // Email new eSIM activation details to the user
        await this.mailService.sendEsimDetails(
          email,
          providerOrder.iccid,
          providerOrder.qrCodeUrl,
          providerOrder.smDpAddress,
          providerOrder.activationCode,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to provision eSIM for order ${orderId}: ${(err as Error).message}`,
      );

      // Mark order as FAILED
      await this.prisma.esimOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.FAILED,
        },
      });

      this.logger.error(`Order ${orderId} marked as FAILED.`);
      throw err;
    }
  }
}
