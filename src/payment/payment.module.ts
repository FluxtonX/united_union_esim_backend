import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { EsimProvisionService } from './esim-provision.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [PaymentController],
  providers: [PaymentService, EsimProvisionService],
  exports: [PaymentService, EsimProvisionService],
})
export class PaymentModule {}
