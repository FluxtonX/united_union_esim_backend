import { Module, Global } from '@nestjs/common';
import { ESIM_PROVIDER } from './interfaces/esim-provider.interface';
import { YesimAdapter } from './yesim/yesim.adapter';

@Global()
@Module({
  providers: [
    {
      provide: ESIM_PROVIDER,
      useClass: YesimAdapter,
    },
  ],
  exports: [ESIM_PROVIDER],
})
export class ProviderModule {}
