import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EsimProvisionService } from '../esim-provision.service';

@Processor('esim-provision')
@Injectable()
export class ProvisionProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisionProcessor.name);

  constructor(
    private readonly esimProvisionService: EsimProvisionService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { orderId, planId, email } = job.data;
    this.logger.log(`Processing eSIM provisioning job ${job.id} for Order: ${orderId}`);

    // Delegate to shared provision service
    return this.esimProvisionService.provision(orderId, planId, email, job.attemptsMade);
  }
}
