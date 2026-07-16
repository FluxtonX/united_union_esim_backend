import { Injectable, Inject, NotFoundException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  ESIM_PROVIDER,
  EsimProvider,
  ProviderPlan,
} from '../providers/interfaces/esim-provider.interface';
import { PrismaService } from '../database/prisma.service';

export interface CountryListItem {
  name: string;
  code: string;
  flagUrl: string;
  plansCount: number;
  startingPriceUsd: number;
  startingPrice?: number;
  currency?: string;
}

@Injectable()
export class CatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogService.name);
  private readonly provider: EsimProvider;

  constructor(
    @Inject(ESIM_PROVIDER) provider: any,
    private readonly prisma: PrismaService,
  ) {
    this.provider = provider as EsimProvider;
  }

  private readonly supportedCountries = [
    { name: 'United States', code: 'US', flag: '🇺🇸' },
    { name: 'United Kingdom', code: 'GB', flag: '🇬🇧' },
    { name: 'Japan', code: 'JP', flag: '🇯🇵' },
    { name: 'France', code: 'FR', flag: '🇫🇷' },
    { name: 'Germany', code: 'DE', flag: '🇩🇪' },
    { name: 'Singapore', code: 'SG', flag: '🇸🇬' },
    { name: 'Philippines', code: 'PH', flag: '🇵🇭' },
    { name: 'Thailand', code: 'TH', flag: '🇹🇭' },
    { name: 'Spain', code: 'ES', flag: '🇪🇸' },
    { name: 'Italy', code: 'IT', flag: '🇮🇹' },
    { name: 'Europe', code: 'EU', flag: '🇪🇺' },
    { name: 'Asia', code: 'AS', flag: '🌏' },
    { name: 'Middle East', code: 'ME', flag: '🐪' },
    { name: 'Global', code: 'GLOBAL', flag: '🌐' },
  ];

  async getCountries(currency?: string): Promise<CountryListItem[]> {
    const list: CountryListItem[] = [];
    const selectedCurrency = currency?.toUpperCase() === 'EUR' ? 'EUR' : 'USD';

    for (const c of this.supportedCountries) {
      try {
        const plans = await this.provider.getPlans(c.code, currency);
        const activePlans = plans.filter((p) => !p.isTopUp);

        if (activePlans.length > 0) {
          const minPriceUsd = Math.min(...activePlans.map((p) => p.priceUsd));
          const minPrice = Math.min(...activePlans.map((p) => p.price ?? p.priceUsd));
          list.push({
            name: c.name,
            code: c.code,
            flagUrl: c.flag,
            plansCount: activePlans.length,
            startingPriceUsd: minPriceUsd,
            startingPrice: minPrice,
            currency: selectedCurrency,
          });
        }
      } catch {
        // Skip country if provider lookup fails
      }
    }

    return list;
  }

  async getPlans(countryCode: string, currency?: string): Promise<ProviderPlan[]> {
    const code = countryCode.toUpperCase().trim();
    const isSupported = this.supportedCountries.some((c) => c.code === code);

    if (!isSupported) {
      throw new NotFoundException(
        `Country code '${countryCode}' is not supported.`,
      );
    }

    const plans = await this.provider.getPlans(code, currency);
    return plans.filter((p) => !p.isTopUp);
  }

  async onApplicationBootstrap() {
    try {
      const count = await this.prisma.supportedDevice.count();
      if (count === 0) {
        this.logger.log('No supported devices found in database. Triggering initial Yesim sync...');
        await this.syncSupportedDevices();
      }
    } catch (err) {
      this.logger.error(`Failed to auto-sync supported devices on startup: ${(err as Error).message}`);
    }
  }

  async syncSupportedDevices(): Promise<number> {
    try {
      const devices = await this.provider.getSupportedDevices();
      let upsertedCount = 0;

      for (const d of devices) {
        try {
          await this.prisma.supportedDevice.upsert({
            where: {
              brand_model: {
                brand: d.brand,
                model: d.model,
              },
            },
            update: {
              type: d.type,
            },
            create: {
              type: d.type,
              brand: d.brand,
              model: d.model,
            },
          });
          upsertedCount++;
        } catch (err) {
          this.logger.warn(`Failed to sync device ${d.brand} ${d.model}: ${(err as Error).message}`);
        }
      }
      this.logger.log(`Successfully synced ${upsertedCount} supported devices from Yesim`);
      return upsertedCount;
    } catch (err) {
      this.logger.error(`Failed to sync supported devices: ${(err as Error).message}`);
      throw err;
    }
  }

  async getDevicesGrouped(): Promise<Record<string, Array<{ model: string; type: string }>>> {
    const devices = await this.prisma.supportedDevice.findMany({
      orderBy: [
        { brand: 'asc' },
        { model: 'asc' },
      ],
    });

    const grouped = devices.reduce((acc, current) => {
      const { brand, model, type } = current;
      if (!acc[brand]) {
        acc[brand] = [];
      }
      acc[brand].push({ model, type });
      return acc;
    }, {} as Record<string, Array<{ model: string; type: string }>>);

    return grouped;
  }

  async checkDeviceCompatibility(brand: string, model: string): Promise<boolean> {
    const dbDevice = await this.prisma.supportedDevice.findFirst({
      where: {
        brand: { equals: brand.trim(), mode: 'insensitive' },
        model: { equals: model.trim(), mode: 'insensitive' },
      },
    });
    return !!dbDevice;
  }
}
