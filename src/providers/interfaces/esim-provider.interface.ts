export interface ProviderPlan {
  id: string;
  name: string;
  dataGb: number;
  durationDays: number;
  priceUsd: number;
  countryCode: string;
  isTopUp: boolean;
}

export interface ProviderOrder {
  orderId: string;
  iccid: string;
  qrCodeUrl: string;
  smDpAddress: string;
  activationCode: string;
}

export interface ProviderEsimDetails {
  iccid: string;
  status: string; // active, inactive, expired
  dataTotalBytes: number;
  dataUsedBytes: number;
  dataRemainingBytes: number;
  expiresAt: Date | null;
}

export interface EsimProvider {
  getPlans(countryCode?: string): Promise<ProviderPlan[]>;
  orderEsim(planId: string, email: string): Promise<ProviderOrder>;
  getEsimDetails(iccid: string): Promise<ProviderEsimDetails>;
  topupEsim(iccid: string, planId: string): Promise<ProviderOrder>;
}

export const ESIM_PROVIDER = Symbol('ESIM_PROVIDER');
