export interface ProviderPlan {
  id: string;
  name: string;
  dataGb: number;
  durationDays: number;
  priceUsd: number;
  price?: number;
  currency?: string;
  countryCode: string;
  isTopUp: boolean;
}

export interface ProviderOrder {
  orderId: string;
  iccid: string;
  qrCodeUrl: string;
  smDpAddress: string;
  activationCode: string;
  yesimUserId?: string;
}

export interface ProviderEsimDetails {
  iccid: string;
  status: string; // active, inactive, expired
  statusString?: string; // raw qr code status: Released, Installed, Deleted, Enabled, Disabled
  dataTotalBytes: number;
  dataUsedBytes: number;
  dataRemainingBytes: number;
  expiresAt: Date | null;
}

export interface EsimProvider {
  getPlans(countryCode?: string, currency?: string): Promise<ProviderPlan[]>;
  orderEsim(planId: string, email: string, yesimUserId?: string): Promise<ProviderOrder>;
  getEsimDetails(iccid: string): Promise<ProviderEsimDetails>;
  topupEsim(iccid: string, planId: string): Promise<ProviderOrder>;
  changeEsim(iccid: string): Promise<ProviderOrder>;
  getBalance(): Promise<{ balance: number; currency: string }>;
  cancelPlan(iccid: string): Promise<void>;
  setNotificationUrl(url: string): Promise<void>;
  getSupportedDevices(): Promise<Array<{ type: string; brand: string; model: string }>>;
}

export const ESIM_PROVIDER = Symbol('ESIM_PROVIDER');
