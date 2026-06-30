import { Module } from '@nestjs/common';
import { ProvisionProcessor } from './processors/provision.processor';
import { ProviderModule } from '../providers/provider.module';

@Module({
  imports: [ProviderModule],
  providers: [ProvisionProcessor],
})
export class QueuesProcessorModule {}
