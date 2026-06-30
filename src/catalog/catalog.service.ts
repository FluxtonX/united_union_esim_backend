import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ESIM_PROVIDER, EsimProvider, ProviderPlan } from '../providers/interfaces/esim-provider.interface';

export interface CountryListItem {
  name: string;
  code: string;
  flagUrl: string;
  plansCount: number;
  startingPriceUsd: number;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(ESIM_PROVIDER) private readonly provider: any,
  ) {}

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
  ];

  async getCountries(): Promise<CountryListItem[]> {
    const list: CountryListItem[] = [];

    for (const c of this.supportedCountries) {
      try {
        const plans = await this.provider.getPlans(c.code);
        const activePlans = plans.filter((p) => !p.isTopUp);

        if (activePlans.length > 0) {
          const minPrice = Math.min(...activePlans.map((p) => p.priceUsd));
          list.push({
            name: c.name,
            code: c.code,
            flagUrl: c.flag,
            plansCount: activePlans.length,
            startingPriceUsd: minPrice,
          });
        }
      } catch {
        // Skip country if provider lookup fails
      }
    }

    return list;
  }

  async getPlans(countryCode: string): Promise<ProviderPlan[]> {
    const code = countryCode.toUpperCase().trim();
    const isSupported = this.supportedCountries.some((c) => c.code === code);

    if (!isSupported) {
      throw new NotFoundException(`Country code '${countryCode}' is not supported.`);
    }

    const plans = await this.provider.getPlans(code);
    return plans.filter((p) => !p.isTopUp);
  }
}
