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
  ): Promise<void> {
    this.logger.log(
      `[EsimProvisionService] Starting provisioning for Order: ${orderId}`,
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
      // Provision eSIM from provider (Yesim API)
      const providerOrder = await this.provider.orderEsim(planId, email);

      // Update database status to PROVISIONED
      await this.prisma.esimOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.PROVISIONED,
          iccid: providerOrder.iccid,
          qrCodeUrl: providerOrder.qrCodeUrl,
          smDpAddress: providerOrder.smDpAddress,
          activationCode: providerOrder.activationCode,
        },
      });

      this.logger.log(
        `Order ${orderId} successfully provisioned with ICCID: ${providerOrder.iccid}`,
      );

      // Email eSIM activation credentials to the user
      await this.mailService.sendEsimDetails(
        email,
        providerOrder.iccid,
        providerOrder.qrCodeUrl,
        providerOrder.smDpAddress,
        providerOrder.activationCode,
      );
    } catch (err) {
      this.logger.error(
        `Failed to provision eSIM for order ${orderId}: ${(err as Error).message}`,
      );

      // Immediately mark as FAILED on synchronous provision error since background queues are removed
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
