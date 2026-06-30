import { Module, Global } from '@nestjs/common';
import { ESIM_PROVIDER } from './interfaces/esim-provider.interface';
import { MayaAdapter } from './maya/maya.adapter';

@Global()
@Module({
  providers: [
    {
      provide: ESIM_PROVIDER,
      useClass: MayaAdapter,
    },
  ],
  exports: [ESIM_PROVIDER],
})
export class ProviderModule {}
