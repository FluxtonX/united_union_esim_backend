import { Injectable, Logger } from '@nestjs/common';
import {
  EsimProvider,
  ProviderPlan,
  ProviderOrder,
  ProviderEsimDetails,
} from '../interfaces/esim-provider.interface';

@Injectable()
export class MayaAdapter implements EsimProvider {
  private readonly logger = new Logger(MayaAdapter.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly isMockMode: boolean;

  constructor() {
    this.apiUrl = process.env.MAYA_API_URL || 'https://api.sandbox.maya.net/v1';
    this.apiKey = process.env.MAYA_API_KEY || 'sandbox_key_xyz';
    this.isMockMode = this.apiKey === 'sandbox_key_xyz' || !process.env.MAYA_API_KEY;

    if (this.isMockMode) {
      this.logger.warn(
        '[MayaAdapter] No valid MAYA_API_KEY detected in environment. Running in MOCK SANDBOX mode.',
      );
    }
  }

  async getPlans(countryCode?: string): Promise<ProviderPlan[]> {
    if (this.isMockMode) {
      return this.getMockPlans(countryCode);
    }

    try {
      const response = await fetch(`${this.apiUrl}/plans?country=${countryCode || ''}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Maya API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return data.plans.map((p: any) => ({
        id: p.id,
        name: p.name,
        dataGb: p.data_gb,
        durationDays: p.duration_days,
        priceUsd: p.price_usd,
        countryCode: p.country_code,
        isTopUp: p.is_topup || false,
      }));
    } catch (err) {
      this.logger.error(`Failed to fetch plans from Maya Mobile: ${(err as Error).message}`);
      // Fallback to mock on error to maintain service availability
      return this.getMockPlans(countryCode);
    }
  }

  async orderEsim(planId: string, email: string): Promise<ProviderOrder> {
    if (this.isMockMode) {
      // Simulate API latency
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockIccid = `890490320000${Math.floor(10000000 + Math.random() * 90000000)}`;
      return {
        orderId: `maya_ord_${Math.random().toString(36).substring(2, 10)}`,
        iccid: mockIccid,
        qrCodeUrl: `LPA:1$rsp.truphone.com$${Math.random().toString(36).substring(2, 15).toUpperCase()}`,
        smDpAddress: 'rsp.truphone.com',
        activationCode: `MOCK-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      };
    }

    try {
      const response = await fetch(`${this.apiUrl}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan_id: planId,
          customer_email: email,
        }),
      });

      if (!response.ok) {
        throw new Error(`Maya API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return {
        orderId: data.order_id,
        iccid: data.iccid,
        qrCodeUrl: data.lpa_string,
        smDpAddress: data.smdp_address,
        activationCode: data.activation_code,
      };
    } catch (err) {
      this.logger.error(`Failed to order eSIM from Maya Mobile: ${(err as Error).message}`);
      throw new Error(`eSIM provisioning failed: ${(err as Error).message}`);
    }
  }

  async getEsimDetails(iccid: string): Promise<ProviderEsimDetails> {
    if (this.isMockMode) {
      return {
        iccid,
        status: 'active',
        dataTotalBytes: 5 * 1024 * 1024 * 1024, // 5GB
        dataUsedBytes: 2.1 * 1024 * 1024 * 1024, // 2.1GB
        dataRemainingBytes: 2.9 * 1024 * 1024 * 1024,
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days left
      };
    }

    try {
      const response = await fetch(`${this.apiUrl}/esims/${iccid}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Maya API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return {
        iccid: data.iccid,
        status: data.status, // active, inactive, expired
        dataTotalBytes: data.data_total_bytes,
        dataUsedBytes: data.data_used_bytes,
        dataRemainingBytes: data.data_total_bytes - data.data_used_bytes,
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      };
    } catch (err) {
      this.logger.error(`Failed to get eSIM details from Maya Mobile: ${(err as Error).message}`);
      throw new Error(`Failed to query eSIM status: ${(err as Error).message}`);
    }
  }

  async topupEsim(iccid: string, planId: string): Promise<ProviderOrder> {
    if (this.isMockMode) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return {
        orderId: `maya_top_${Math.random().toString(36).substring(2, 10)}`,
        iccid,
        qrCodeUrl: '',
        smDpAddress: '',
        activationCode: '',
      };
    }

    try {
      const response = await fetch(`${this.apiUrl}/esims/${iccid}/topup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan_id: planId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Maya API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return {
        orderId: data.order_id,
        iccid,
        qrCodeUrl: '',
        smDpAddress: '',
        activationCode: '',
      };
    } catch (err) {
      this.logger.error(`Failed to apply eSIM top-up from Maya Mobile: ${(err as Error).message}`);
      throw new Error(`eSIM top-up failed: ${(err as Error).message}`);
    }
  }

  // Mock plans generator helper
  private getMockPlans(countryCode?: string): ProviderPlan[] {
    const code = (countryCode || 'US').toUpperCase();
    const plans: ProviderPlan[] = [
      {
        id: `maya_${code.toLowerCase()}_1gb_7d`,
        name: `${code} Lite — 1 GB`,
        dataGb: 1,
        durationDays: 7,
        priceUsd: 4.90,
        countryCode: code,
        isTopUp: false,
      },
      {
        id: `maya_${code.toLowerCase()}_5gb_30d`,
        name: `${code} Smart — 5 GB`,
        dataGb: 5,
        durationDays: 30,
        priceUsd: 12.50,
        countryCode: code,
        isTopUp: false,
      },
      {
        id: `maya_${code.toLowerCase()}_10gb_30d`,
        name: `${code} Premium — 10 GB`,
        dataGb: 10,
        durationDays: 30,
        priceUsd: 22.00,
        countryCode: code,
        isTopUp: false,
      },
    ];

    return plans;
  }
}
