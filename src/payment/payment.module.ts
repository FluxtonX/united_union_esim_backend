import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { QueueModule } from '../queues/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
