import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ProviderModule } from '../providers/provider.module';

@Module({
  imports: [ProviderModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
