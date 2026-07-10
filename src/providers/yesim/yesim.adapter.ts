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

      // Map plans to standard ProviderPlan interface
      const mappedPlans: ProviderPlan[] = filteredData.map((p) => ({
        id: p.id,
        name: p.name || `${p.countries_included || 'eSIM'} Plan`,
        dataGb: parseFloat(p.data || '0'),
        durationDays: parseInt(p.days || '0', 10),
        priceUsd: parseFloat(p.price || '0'),
        countryCode: countryCode
          ? countryCode.toUpperCase().trim()
          : p.countryIso2 || '',
        isTopUp: false, // Yesim plans can be activated on new or existing eSIMs
      }));

      return mappedPlans;
    } catch (err) {
      this.logger.error(
        `Failed to fetch plans from Yesim: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async orderEsim(planId: string, email: string): Promise<ProviderOrder> {
    if (this.isMockMode) {
      // Simulate API latency
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockIccid = `8937204017${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      const mockActivationCode = `K2-${Math.random().toString(36).substring(2, 10).toUpperCase()}-MOCK`;
      return {
        orderId: `yesim_ord_${Math.random().toString(36).substring(2, 10)}`,
        iccid: mockIccid,
        qrCodeUrl: `LPA:1$smdp.io$${mockActivationCode}`,
        smDpAddress: 'smdp.io',
        activationCode: mockActivationCode,
      };
    }

    try {
      // 1. Try to create the user on core.yesim.biz (optional step, fails gracefully if exists)
      let yesimUserId: string | undefined;
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
          yesimUserId = userData.user_id;
          this.logger.log(
            `Created new Yesim user ID: ${yesimUserId} for ${email}`,
          );
        } else {
          // It could fail because user already exists. We check the status code/response.
          const errorData = (await userResponse
            .json()
            .catch(() => null)) as unknown;
          this.logger.warn(
            `Yesim new_user responded with status ${userResponse.status}: ${JSON.stringify(errorData)}`,
          );
        }
      } catch (userErr) {
        this.logger.warn(
          `Yesim new_user request failed (continuing to eSIM order): ${(userErr as Error).message}`,
        );
      }

      // 2. Request new eSIM and activate plan
      const userParam = yesimUserId ? `&user_id=${yesimUserId}` : '';
      const response = await fetch(
        `${this.apiUrl}/new_esim?token=${this.apiToken}&plan_id=${planId}${userParam}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Yesim API /new_esim error: ${response.statusText}`);
      }

      const data = (await response.json()) as YesimNewEsimResponse;
      const qrcode = data.qrcode || '';

      if (
        typeof data === 'string' &&
        (data as string).includes('out of stock')
      ) {
        throw new Error('Yesim eSIMs are currently out of stock');
      }

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
          data.id || `yesim_ord_${Math.random().toString(36).substring(2, 10)}`,
        iccid: data.iccid || '',
        qrCodeUrl: qrcode,
        smDpAddress,
        activationCode,
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
        dataTotalBytes: 5 * 1024 * 1024 * 1024, // 5GB
        dataUsedBytes: 1.2 * 1024 * 1024 * 1024, // 1.2GB
        dataRemainingBytes: 3.8 * 1024 * 1024 * 1024,
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days left
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

      const data = (await response.json()) as YesimSimInfoResponse;

      const rawTotal = data.data_package_mb || 0;
      const rawUsed = data.data_used_mb || 0;
      const rawLeft = data.data_left_mb || 0;

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
        iccid: data.iccid || '',
        status:
          data.is_deleted === '1'
            ? 'expired'
            : (data.status_qr || 'active').toLowerCase(),
        dataTotalBytes,
        dataUsedBytes,
        dataRemainingBytes,
        expiresAt: data.plan_expired_at ? new Date(data.plan_expired_at) : null,
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

      if (!response.ok) {
        throw new Error(
          `Yesim API /add_plan_iccid error: ${response.statusText}`,
        );
      }

      const data = (await response.json()) as YesimTopupResponse;
      if (data.status !== 'success') {
        throw new Error(data.description || 'API transaction failed');
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

  // Mock plans generator helper
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
