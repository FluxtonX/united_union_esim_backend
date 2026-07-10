import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { EsimProvisionService } from './esim-provision.service';

@Module({
  controllers: [PaymentController],
  providers: [PaymentService, EsimProvisionService],
  exports: [EsimProvisionService],
})
export class PaymentModule {}
