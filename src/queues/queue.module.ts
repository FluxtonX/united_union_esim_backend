import { Module, Global } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { EsimProvisionService } from './esim-provision.service';

// Enable BullMQ only if bypass is not requested and Redis host is configured
const useQueue = process.env.BYPASS_QUEUE !== 'true' && !!process.env.REDIS_HOST;

@Global()
@Module({
  imports: useQueue
    ? [
        BullModule.forRoot({
          connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
          },
        }),
        BullModule.registerQueue({
          name: 'esim-provision',
        }),
      ]
    : [],
  providers: [
    EsimProvisionService,
    ...(useQueue
      ? []
      : [
          {
            provide: getQueueToken('esim-provision'),
            useValue: {
              add: async () => {
                // Mock add method to gracefully do nothing when queue is bypassed
                return null;
              },
            },
          },
        ]),
  ],
  exports: [
    EsimProvisionService,
    ...(useQueue ? [BullModule] : [getQueueToken('esim-provision')]),
  ],
})
export class QueueModule {}
