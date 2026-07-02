import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ESIM_PROVIDER } from '../providers/interfaces/esim-provider.interface';
import { MailService } from '../mail/mail.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class EsimProvisionService {
  private readonly logger = new Logger(EsimProvisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ESIM_PROVIDER) private readonly provider: any,
    private readonly mailService: MailService,
  ) {}

  async provision(orderId: string, planId: string, email: string, attemptsMade = 0): Promise<void> {
    this.logger.log(`[EsimProvisionService] Starting provisioning for Order: ${orderId}`);

    const order = await this.prisma.esimOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      this.logger.error(`Order ${orderId} not found in database. Terminating provisioning.`);
      return;
    }

    if (order.status !== OrderStatus.PENDING) {
      this.logger.warn(`Order ${orderId} is already processed (Status: ${order.status}). Skipping.`);
      return;
    }

    try {
      // Provision eSIM from provider (Maya Mobile)
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

      this.logger.log(`Order ${orderId} successfully provisioned with ICCID: ${providerOrder.iccid}`);

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
        `Failed to provision eSIM for order ${orderId}: ${(err as Error).message}. Attempt: ${attemptsMade + 1}`,
      );

      // Update DB to FAILED if all retry attempts are exhausted (e.g. 3 attempts)
      if (attemptsMade >= 2) {
        await this.prisma.esimOrder.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.FAILED,
          },
        });
        this.logger.error(`All retry attempts exhausted. Order ${orderId} marked as FAILED.`);
      }

      // Rethrow to trigger BullMQ backoff retry logic (if called from queue)
      throw err;
    }
  }
}
