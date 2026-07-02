import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { ProviderModule } from './providers/provider.module';
import { CatalogModule } from './catalog/catalog.module';
import { PaymentModule } from './payment/payment.module';
import { QueuesProcessorModule } from './queues/queues-processor.module';
import { ThrottlerModule } from '@nestjs/throttler';

const imports = [
  PrismaModule,
  MailModule,
  AuthModule,
  ProviderModule,
  CatalogModule,
  PaymentModule,
  ThrottlerModule.forRoot([{
    ttl: 60000,
    limit: 60,
  }]),
];

// Conditionally load QueuesProcessorModule only if queue processing is enabled
if (process.env.BYPASS_QUEUE !== 'true' && !!process.env.REDIS_HOST) {
  imports.push(QueuesProcessorModule);
}

@Module({
  imports: imports,
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
