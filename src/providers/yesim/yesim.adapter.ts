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

  async getPlans(countryCode?: string): Promise<ProviderPlan[]> {
    if (this.isMockMode) {
      return this.getMockPlans(countryCode);
    }

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

      let filteredData = data;
      if (countryCode) {
        const target = countryCode.toUpperCase().trim();
        if (target === 'EU' || target === 'EUROPE') {
          filteredData = data.filter(
            (p) =>
              p.plan_type === 'region' &&
              (p.countries_included?.toLowerCase().includes('europe') ||
                p.name?.toLowerCase().includes('europe') ||
                p.countryIso2?.toUpperCase() === 'EU'),
          );
        } else if (target === 'AS' || target === 'ASIA') {
          filteredData = data.filter(
            (p) =>
              p.plan_type === 'region' &&
              (p.countries_included?.toLowerCase().includes('asia') ||
                p.name?.toLowerCase().includes('asia') ||
                p.countryIso2?.toUpperCase() === 'AS'),
          );
        } else if (target === 'ME' || target === 'MIDDLE EAST') {
          filteredData = data.filter(
            (p) =>
              p.plan_type === 'region' &&
              (p.countries_included?.toLowerCase().includes('middle east') ||
                p.name?.toLowerCase().includes('middle east') ||
                p.countryIso2?.toUpperCase() === 'ME'),
          );
        } else if (target === 'GLOBAL') {
          filteredData = data.filter(
            (p) =>
              p.plan_type === 'region' &&
              (p.countries_included?.toLowerCase().includes('global') ||
                p.name?.toLowerCase().includes('global') ||
                p.countryIso2?.toUpperCase() === 'GLOBAL'),
          );
        } else {
          filteredData = data.filter((p) => {
            if (!p.countryIso2) return false;
            const codes = p.countryIso2
              .toUpperCase()
              .split(',')
              .map((c) => c.trim());
            return codes.includes(target);
          });
        }
      }

      const eurToUsdRate = await this.getEurToUsdRate();

      // Map plans to standard ProviderPlan interface
      const mappedPlans: ProviderPlan[] = filteredData.map((p) => {
        const rawPrice = parseFloat(p.price || '0');
        const priceUsd = p.currency === 'USD' ? rawPrice : rawPrice * eurToUsdRate;

        return {
          id: p.id,
          name: p.name || `${p.countries_included || 'eSIM'} Plan`,
          dataGb: parseFloat(p.data || '0'),
          durationDays: parseInt(p.days || '0', 10),
          priceUsd: parseFloat(priceUsd.toFixed(2)),
          countryCode: countryCode
            ? countryCode.toUpperCase().trim()
            : p.countryIso2 || '',
          isTopUp: false,
        };
      });

      return mappedPlans;
    } catch (err) {
      this.logger.error(
        `Failed to fetch plans from Yesim: ${(err as Error).message}`,
      );
      throw err;
    }
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

  private getMockPlans(countryCode?: string): ProviderPlan[] {
    const code = (countryCode || 'US').toUpperCase();
    const plans: ProviderPlan[] = [
      {
        id: `yesim_${code.toLowerCase()}_1gb_7d`,
        name: `${code} Lite — 1 GB`,
        dataGb: 1,
        durationDays: 7,
        priceUsd: 4.9,
        countryCode: code,
        isTopUp: false,
      },
      {
        id: `yesim_${code.toLowerCase()}_5gb_30d`,
        name: `${code} Smart — 5 GB`,
        dataGb: 5,
        durationDays: 30,
        priceUsd: 12.5,
        countryCode: code,
        isTopUp: false,
      },
      {
        id: `yesim_${code.toLowerCase()}_10gb_30d`,
        name: `${code} Premium — 10 GB`,
        dataGb: 10,
        durationDays: 30,
        priceUsd: 22.0,
        countryCode: code,
        isTopUp: false,
      },
    ];

    return plans;
  }
}
