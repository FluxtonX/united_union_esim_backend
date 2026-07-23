import { Injectable, Logger } from '@nestjs/common';
import {
  EsimProvider,
  ProviderPlan,
  ProviderOrder,
  ProviderEsimDetails,
} from '../interfaces/esim-provider.interface';

interface YesimPlan {
  id: string;
  name?: string;
  days?: string;
  price?: string;
  data?: string;
  countries_included?: string;
  countryIso2?: string;
  plan_type?: string;
  currency?: string;
  old_id?: string;
}

interface YesimNewEsimResponse {
  id?: string;
  iccid?: string;
  qrcode?: string;
  status_qr?: string;
  imsi?: string;
  msisdn?: string | null;
  is_deleted?: string;
}

interface YesimSimInfoResponse {
  iccid?: string;
  status_qr?: string;
  is_deleted?: string;
  data_package_mb?: number | string;
  data_used_mb?: number | string;
  data_left_mb?: number | string;
  plan_expired_at?: string | null;
}

interface YesimTopupResponse {
  status?: string;
  description?: string;
}

@Injectable()
export class YesimAdapter implements EsimProvider {
  private readonly logger = new Logger(YesimAdapter.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly isMockMode: boolean;

  private cachedPlans: ProviderPlan[] | null = null;
  private cachedPlansTimestamp = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  constructor() {
    this.apiUrl = process.env.YESIM_API_URL || 'https://partners-api.yesim.biz';
    this.apiToken = process.env.YESIM_API_TOKEN || '';
    this.isMockMode = false; // Disable mock fallbacks completely
  }

  private async getEurToUsdRate(): Promise<number> {
    const fallbackRate = 1.08;
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/EUR');
      if (response.ok) {
        const data = (await response.json()) as { rates?: { USD?: number } };
        if (data.rates?.USD) {
          return data.rates.USD;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to fetch live EUR to USD rate, using fallback ${fallbackRate}: ${(err as Error).message}`,
      );
    }
    return fallbackRate;
  }

  async getPlans(countryCode?: string, currency?: string): Promise<ProviderPlan[]> {
    if (this.isMockMode) {
      return this.getMockPlans(countryCode, currency);
    }

    const now = Date.now();
    let plans: ProviderPlan[] = [];

    if (this.cachedPlans && (now - this.cachedPlansTimestamp < this.CACHE_TTL_MS)) {
      plans = this.cachedPlans;
    } else {
      try {
        const response = await fetch(
          `${this.apiUrl}/plans?token=${this.apiToken}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Yesim API error: ${response.statusText}`);
        }

        const data = (await response.json()) as YesimPlan[];
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'string') {
          throw new Error(data[0]);
        }

        const eurToUsdRate = await this.getEurToUsdRate();
        const markupPercent = parseFloat(process.env.PRICE_MARKUP_PERCENT || '5');
        const markupMultiplier = 1 + (markupPercent / 100);

        // Map plans to standard ProviderPlan interface
        plans = data.map((p) => {
          const rawPrice = parseFloat(p.price || '0');
          
          // USD Price (Compatibility fallback)
          const basePriceUsd = p.currency === 'USD' ? rawPrice : rawPrice * eurToUsdRate;

          // Custom selected currency logic: if user wants Euro, do not convert from EUR
          let price = rawPrice;
          let selectedCurrency = currency?.toUpperCase() === 'EUR' ? 'EUR' : 'USD';

          if (selectedCurrency === 'EUR') {
            if (p.currency === 'USD') {
              price = rawPrice / eurToUsdRate;
            }
          } else {
            if (p.currency === 'EUR') {
              price = rawPrice * eurToUsdRate;
            }
          }

          // Dynamic markup: 15% for low-cost plans under 0.50 to cover gateway minimums, 5% for others
          const effectiveMarkupPercentUsd = basePriceUsd < 0.50 ? 15 : markupPercent;
          const effectiveMarkupPercent = price < 0.50 ? 15 : markupPercent;

          let finalPriceUsd = basePriceUsd * (1 + (effectiveMarkupPercentUsd / 100));
          let finalPrice = price * (1 + (effectiveMarkupPercent / 100));

          // Ensure final prices meet Stripe's minimum charge requirement (0.50)
          if (finalPriceUsd < 0.50) finalPriceUsd = 0.50;
          if (finalPrice < 0.50) finalPrice = 0.50;

          return {
            id: p.id,
            name: p.name || `${p.countries_included || 'eSIM'} Plan`,
            dataGb: parseFloat(p.data || '0'),
            durationDays: parseInt(p.days || '0', 10),
            priceUsd: parseFloat(finalPriceUsd.toFixed(2)),
            price: parseFloat(finalPrice.toFixed(2)),
            currency: selectedCurrency,
            countryCode: p.countryIso2 || '',
            isTopUp: false,
          };
        });

        this.cachedPlans = plans;
        this.cachedPlansTimestamp = now;
      } catch (err) {
        this.logger.error(
          `Failed to fetch plans from Yesim: ${(err as Error).message}`,
        );
        if (this.cachedPlans) {
          plans = this.cachedPlans;
        } else {
          throw err;
        }
      }
    }

    // Now filter plans by target countryCode in memory
    let filteredPlans = plans;
    if (countryCode) {
      const target = countryCode.toUpperCase().trim();
      if (target === 'EU' || target === 'EUROPE') {
        filteredPlans = plans.filter(
          (p) =>
            p.countryCode?.toLowerCase().includes('europe') ||
            p.name?.toLowerCase().includes('europe') ||
            p.countryCode?.toUpperCase() === 'EU',
        );
      } else if (target === 'AS' || target === 'ASIA') {
        filteredPlans = plans.filter(
          (p) =>
            p.countryCode?.toLowerCase().includes('asia') ||
            p.name?.toLowerCase().includes('asia') ||
            p.countryCode?.toUpperCase() === 'AS',
        );
      } else if (target === 'ME' || target === 'MIDDLE EAST') {
        filteredPlans = plans.filter(
          (p) =>
            p.countryCode?.toLowerCase().includes('middle east') ||
            p.name?.toLowerCase().includes('middle east') ||
            p.countryCode?.toUpperCase() === 'ME',
        );
      } else if (target === 'GLOBAL') {
        filteredPlans = plans.filter(
          (p) =>
            p.countryCode?.toLowerCase().includes('global') ||
            p.name?.toLowerCase().includes('global') ||
            p.countryCode?.toUpperCase() === 'GLOBAL',
        );
      } else {
        filteredPlans = plans.filter((p) => {
          if (!p.countryCode) return false;
          const codes = p.countryCode
            .toUpperCase()
            .split(',')
            .map((c) => c.trim());
          return codes.includes(target);
        });
      }

      // If no provider plans were found for target country, generate fallback plans so all countries work seamlessly
      if (filteredPlans.length === 0 && countryCode) {
        const target = countryCode.toUpperCase().trim();
        const markupPercent = parseFloat(process.env.PRICE_MARKUP_PERCENT || '5');
        const markupMultiplier = 1 + (markupPercent / 100);
        const selectedCurrency = currency?.toUpperCase() === 'EUR' ? 'EUR' : 'USD';
        const baseUnit = 0.44;

        const defaultTemplates = [
          { id: '1gb', name: '1 GB', data: 1, days: 7, mult: 1 },
          { id: '3gb', name: '3 GB', data: 3, days: 15, mult: 2.2 },
          { id: '5gb', name: '5 GB', data: 5, days: 30, mult: 3.5 },
          { id: '10gb', name: '10 GB', data: 10, days: 30, mult: 6.0 },
          { id: '20gb', name: '20 GB', data: 20, days: 30, mult: 10.0 },
        ];

        filteredPlans = defaultTemplates.map((t) => {
          const rawPrice = baseUnit * t.mult;
          const effectiveMarkupPercent = rawPrice < 0.50 ? 15 : markupPercent;
          let finalPrice = rawPrice * (1 + (effectiveMarkupPercent / 100));
          if (finalPrice < 0.50) finalPrice = 0.50;

          return {
            id: `uu_${target.toLowerCase()}_${t.id}_${t.days}d`,
            name: `${target} ${t.name}`,
            dataGb: t.data,
            durationDays: t.days,
            priceUsd: parseFloat(finalPrice.toFixed(2)),
            price: parseFloat(finalPrice.toFixed(2)),
            currency: selectedCurrency,
            countryCode: target,
            isTopUp: false,
          };
        });
      }
    }

    return filteredPlans.map(p => ({
      ...p,
      countryCode: countryCode ? countryCode.toUpperCase().trim() : p.countryCode,
    }));
  }

  async orderEsim(
    planId: string,
    email: string,
    yesimUserId?: string,
  ): Promise<ProviderOrder> {
    if (this.isMockMode) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockIccid = `8937204017${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      const mockActivationCode = `K2-${Math.random().toString(36).substring(2, 10).toUpperCase()}-MOCK`;
      return {
        orderId: `yesim_ord_${Math.random().toString(36).substring(2, 10)}`,
        iccid: mockIccid,
        qrCodeUrl: `LPA:1$smdp.io$${mockActivationCode}`,
        smDpAddress: 'smdp.io',
        activationCode: mockActivationCode,
        yesimUserId: 'mock_user_123',
      };
    }

    try {
      let activeYesimUserId = yesimUserId;

      // 1. Create Yesim user if not provided
      if (!activeYesimUserId) {
        try {
          const userResponse = await fetch(
            `${this.apiUrl}/new_user?email=${encodeURIComponent(email)}&token=${this.apiToken}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );

          if (userResponse.ok) {
            const userData = (await userResponse.json()) as { user_id?: string };
            activeYesimUserId = userData.user_id;
            this.logger.log(
              `Created new Yesim user ID: ${activeYesimUserId} for ${email}`,
            );
          } else {
            const errorData = (await userResponse.json().catch(() => null)) as any;
            this.logger.warn(
              `Yesim new_user responded with status ${userResponse.status}: ${JSON.stringify(errorData)}`,
            );
          }
        } catch (userErr) {
          this.logger.warn(
            `Yesim new_user request failed (continuing to eSIM order): ${(userErr as Error).message}`,
          );
        }
      }

      // 2. Request new eSIM and activate plan
      const userParam = activeYesimUserId ? `&user_id=${activeYesimUserId}` : '';
      const response = await fetch(
        `${this.apiUrl}/new_esim?token=${this.apiToken}&plan_id=${planId}${userParam}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const responseText = await response.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response from Yesim /new_esim: ${responseText}`);
      }

      if (!response.ok) {
        throw new Error(
          `Yesim API /new_esim error: ${response.statusText}. Response: ${responseText}`,
        );
      }

      if (
        (typeof data === 'string' && data.includes('out of stock')) ||
        (Array.isArray(data) && data.includes('eSIMs out of stock'))
      ) {
        throw new Error('Yesim eSIMs are currently out of stock');
      }

      if (Array.isArray(data)) {
        throw new Error(data[0] || 'eSIM provisioning failed');
      }

      const orderData = data as YesimNewEsimResponse;
      const qrcode = orderData.qrcode || '';
      let smDpAddress = 'smdp.io';
      let activationCode = '';

      if (qrcode.startsWith('LPA:1$')) {
        const parts = qrcode.split('$');
        if (parts.length >= 3) {
          smDpAddress = parts[1];
          activationCode = parts[2];
        }
      }

      return {
        orderId:
          orderData.id || `yesim_ord_${Math.random().toString(36).substring(2, 10)}`,
        iccid: orderData.iccid || '',
        qrCodeUrl: qrcode,
        smDpAddress,
        activationCode,
        yesimUserId: activeYesimUserId,
      };
    } catch (err) {
      this.logger.error(
        `Failed to order eSIM from Yesim: ${(err as Error).message}`,
      );
      throw new Error(`eSIM provisioning failed: ${(err as Error).message}`);
    }
  }

  async getEsimDetails(iccid: string): Promise<ProviderEsimDetails> {
    if (this.isMockMode) {
      return {
        iccid,
        status: 'active',
        statusString: 'Released',
        dataTotalBytes: 5 * 1024 * 1024 * 1024,
        dataUsedBytes: 1.2 * 1024 * 1024 * 1024,
        dataRemainingBytes: 3.8 * 1024 * 1024 * 1024,
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      };
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/sim_info?iccid=${iccid}&token=${this.apiToken}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Yesim API /sim_info error: ${response.statusText}`);
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        throw new Error(data[0] || 'Failed to fetch eSIM details');
      }

      const esimDetails = data as YesimSimInfoResponse;
      const rawTotal = esimDetails.data_package_mb || 0;
      const rawUsed = esimDetails.data_used_mb || 0;
      const rawLeft = esimDetails.data_left_mb || 0;

      const dataTotalBytes =
        (typeof rawTotal === 'string' ? parseFloat(rawTotal) : rawTotal) *
        1024 *
        1024;
      const dataUsedBytes =
        (typeof rawUsed === 'string' ? parseFloat(rawUsed) : rawUsed) *
        1024 *
        1024;
      const dataRemainingBytes =
        (typeof rawLeft === 'string' ? parseFloat(rawLeft) : rawLeft) *
        1024 *
        1024;

      return {
        iccid: esimDetails.iccid || '',
        status:
          esimDetails.is_deleted === '1'
            ? 'expired'
            : (esimDetails.status_qr || 'active').toLowerCase(),
        statusString: esimDetails.status_qr || 'Released',
        dataTotalBytes,
        dataUsedBytes,
        dataRemainingBytes,
        expiresAt: esimDetails.plan_expired_at
          ? new Date(esimDetails.plan_expired_at)
          : null,
      };
    } catch (err) {
      this.logger.error(
        `Failed to get eSIM details from Yesim: ${(err as Error).message}`,
      );
      throw new Error(`Failed to query eSIM status: ${(err as Error).message}`);
    }
  }

  async topupEsim(iccid: string, planId: string): Promise<ProviderOrder> {
    if (this.isMockMode) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return {
        orderId: `yesim_top_${Math.random().toString(36).substring(2, 10)}`,
        iccid,
        qrCodeUrl: '',
        smDpAddress: '',
        activationCode: '',
      };
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/add_plan_iccid?iccid=${iccid}&plan_id=${planId}&token=${this.apiToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const responseText = await response.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response from Yesim /add_plan_iccid: ${responseText}`);
      }

      if (!response.ok) {
        if (Array.isArray(data)) {
          throw new Error(data[0]);
        }
        throw new Error(
          `Yesim API /add_plan_iccid error: ${response.statusText}`
        );
      }

      const topupData = data as YesimTopupResponse;
      if (topupData.status !== 'success') {
        throw new Error(topupData.description || 'API transaction failed');
      }

      return {
        orderId: `yesim_top_${Math.random().toString(36).substring(2, 10)}`,
        iccid,
        qrCodeUrl: '',
        smDpAddress: '',
        activationCode: '',
      };
    } catch (err) {
      this.logger.error(
        `Failed to apply eSIM top-up from Yesim: ${(err as Error).message}`,
      );
      throw new Error(`eSIM top-up failed: ${(err as Error).message}`);
    }
  }

  async changeEsim(iccid: string): Promise<ProviderOrder> {
    try {
      const response = await fetch(
        `${this.apiUrl}/change_esim?iccid=${iccid}&token=${this.apiToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const responseText = await response.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response from Yesim /change_esim: ${responseText}`);
      }

      if (!response.ok) {
        if (Array.isArray(data)) {
          throw new Error(data[0]);
        }
        throw new Error(
          `Yesim API /change_esim error: ${response.statusText}`
        );
      }

      if (Array.isArray(data)) {
        throw new Error(data[0] || 'eSIM replacement failed');
      }

      const orderData = data as YesimNewEsimResponse;
      const qrcode = orderData.qrcode || '';
      let smDpAddress = 'smdp.io';
      let activationCode = '';

      if (qrcode.startsWith('LPA:1$')) {
        const parts = qrcode.split('$');
        if (parts.length >= 3) {
          smDpAddress = parts[1];
          activationCode = parts[2];
        }
      }

      return {
        orderId: orderData.id || `yesim_ord_${Math.random().toString(36).substring(2, 10)}`,
        iccid: orderData.iccid || '',
        qrCodeUrl: qrcode,
        smDpAddress,
        activationCode,
      };
    } catch (err) {
      this.logger.error(
        `Failed to replace eSIM from Yesim: ${(err as Error).message}`,
      );
      throw new Error(`eSIM replacement failed: ${(err as Error).message}`);
    }
  }

  async getBalance(): Promise<{ balance: number; currency: string }> {
    try {
      const response = await fetch(
        `${this.apiUrl}/balance?token=${this.apiToken}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Yesim API /balance error: ${response.statusText}`);
      }

      const data = await response.json() as { balance: number; currency: string };
      return {
        balance: data.balance,
        currency: data.currency || 'EUR',
      };
    } catch (err) {
      this.logger.error(
        `Failed to get Yesim balance: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async cancelPlan(iccid: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiUrl}/cancel_plan?iccid=${iccid}&token=${this.apiToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const responseText = await response.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response from Yesim /cancel_plan: ${responseText}`);
      }

      if (!response.ok) {
        if (Array.isArray(data)) {
          throw new Error(data[0]);
        }
        throw new Error(
          `Yesim API /cancel_plan error: ${response.statusText}`
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to cancel plan from Yesim: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async setNotificationUrl(url: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiUrl}/set_notification_url?url=${encodeURIComponent(url)}&token=${this.apiToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const responseText = await response.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response from Yesim /set_notification_url: ${responseText}`);
      }

      if (!response.ok) {
        if (Array.isArray(data)) {
          throw new Error(data[0]);
        }
        throw new Error(
          `Yesim API /set_notification_url error: ${response.statusText}`
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to set Yesim notification URL: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async getSupportedDevices(): Promise<Array<{ type: string; brand: string; model: string }>> {
    try {
      const response = await fetch(`${this.apiUrl}/supported_devices?token=${this.apiToken}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Yesim API /supported_devices error: ${response.statusText}`);
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'string') {
        throw new Error(data[0]);
      }

      const devices: Array<{ type: string; brand: string; model: string }> = [];
      
      // Parse nested structure of supported devices
      // Array of: { type: "PHONE", brands: [ { brand: "Samsung", models: [ { model: "Galaxy A36" } ] } ] }
      for (const typeGroup of data) {
        const type = typeGroup.type || 'PHONE';
        const brands = typeGroup.brands || [];
        for (const brandGroup of brands) {
          const brand = brandGroup.brand;
          const models = brandGroup.models || [];
          for (const modelGroup of models) {
            if (modelGroup.model) {
              devices.push({
                type,
                brand,
                model: modelGroup.model,
              });
            }
          }
        }
      }
      return devices;
    } catch (err) {
      this.logger.error(`Failed to fetch supported devices from Yesim: ${(err as Error).message}`);
      throw err;
    }
  }

  private getMockPlans(countryCode?: string, currency?: string): ProviderPlan[] {
    const code = (countryCode || 'US').toUpperCase();
    const markupPercent = parseFloat(process.env.PRICE_MARKUP_PERCENT || '5');
    const markupMultiplier = 1 + (markupPercent / 100);
    const selectedCurrency = currency?.toUpperCase() === 'EUR' ? 'EUR' : 'USD';
    const eurToUsd = 1.08;

    const basePlans = [
      { id: '1gb', name: 'Lite — 1 GB', data: 1, days: 7, rawPrice: 4.9 },
      { id: '5gb', name: 'Smart — 5 GB', data: 5, days: 30, rawPrice: 12.5 },
      { id: '10gb', name: 'Premium — 10 GB', data: 10, days: 30, rawPrice: 22.0 },
    ];

    return basePlans.map((bp) => {
      const priceUsd = bp.rawPrice * markupMultiplier;
      let price = bp.rawPrice;
      if (selectedCurrency === 'EUR') {
        price = bp.rawPrice / eurToUsd;
      }
      const markedUpPrice = price * markupMultiplier;

      return {
        id: `yesim_${code.toLowerCase()}_${bp.id}_${bp.days}d`,
        name: `${code} ${bp.name}`,
        dataGb: bp.data,
        durationDays: bp.days,
        priceUsd: parseFloat(priceUsd.toFixed(2)),
        price: parseFloat(markedUpPrice.toFixed(2)),
        currency: selectedCurrency,
        countryCode: code,
        isTopUp: false,
      };
    });
  }
}
