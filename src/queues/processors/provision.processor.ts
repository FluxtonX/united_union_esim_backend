import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ESIM_PROVIDER, EsimProvider } from '../../providers/interfaces/esim-provider.interface';
import { MailService } from '../../mail/mail.service';
import { OrderStatus } from '@prisma/client';

@Processor('esim-provision')
@Injectable()
export class ProvisionProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ESIM_PROVIDER) private readonly provider: any,
    private readonly mailService: MailService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { orderId, planId, email } = job.data;
    this.logger.log(`Processing eSIM provisioning job ${job.id} for Order: ${orderId}`);

    const order = await this.prisma.esimOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      this.logger.error(`Order ${orderId} not found in database. Terminating job.`);
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
        `Failed to provision eSIM for order ${orderId}: ${(err as Error).message}. Attempt: ${job.attemptsMade + 1}`,
      );

      // Update DB to FAILED if all retry attempts are exhausted
      if (job.attemptsMade >= 2) {
        await this.prisma.esimOrder.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.FAILED,
          },
        });
        this.logger.error(`All retry attempts exhausted. Order ${orderId} marked as FAILED.`);
      }

      // Rethrow to trigger BullMQ backoff retry logic
      throw err;
    }
  }
}
