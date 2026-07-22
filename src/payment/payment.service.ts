/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import Stripe from 'stripe';
import { OrderStatus } from '@prisma/client';
import { EsimProvisionService } from './esim-provision.service';
import { ESIM_PROVIDER, EsimProvider } from '../providers/interfaces/esim-provider.interface';


@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly stripe: Stripe;
  private readonly provider: EsimProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly esimProvisionService: EsimProvisionService,
    @Inject(ESIM_PROVIDER) provider: any,
  ) {
    this.provider = provider as EsimProvider;
    this.stripe = new Stripe(process.env.STRIPE_API_KEY || 'sk_test_mock', {
      apiVersion: '2024-12-18.acacia' as any,
    });
  }

  async createCheckoutSession(
    userId: string | undefined,
    email: string | undefined,
    planId: string,
    countryCode: string,
    amount: number,
    iccid?: string,
    currency?: string,
  ): Promise<{ sessionId: string; url: string | null }> {
    let finalUserId = userId;
    let finalEmail = email;

    if (!finalUserId) {
      // Find or create default guest user
      let guestUser = await this.prisma.user.findUnique({
        where: { email: 'guest@unitedunion.com' },
      });
      if (!guestUser) {
        guestUser = await this.prisma.user.create({
          data: {
            email: 'guest@unitedunion.com',
            passwordHash: '$2b$10$hashedpasswordplaceholder',
            firstName: 'Guest',
            lastName: 'User',
            role: 'USER',
            emailVerified: true,
          },
        });
      }
      finalUserId = guestUser.id;
      finalEmail = guestUser.email;
    }

    try {
      const selectedCurrency = currency?.toLowerCase() === 'eur' ? 'eur' : 'usd';
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: selectedCurrency,
              product_data: {
                name: `eSIM Data Plan - ${planId.toUpperCase()}`,
                description: `Travel eSIM for country: ${countryCode.toUpperCase()}`,
              },
              unit_amount: Math.round(amount * 100), // convert to cents
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: finalEmail,
        metadata: {
          userId: finalUserId,
          planId,
          countryCode,
          amount: amount.toString(),
          currency: selectedCurrency.toUpperCase(),
          ...(iccid ? { targetIccid: iccid } : {}),
        },
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/checkout/cancel`,
      });

      return {
        sessionId: session.id,
        url: session.url,
      };
    } catch (err) {
      this.logger.error(
        `Stripe session creation failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to initialize payment gateway.');
    }
  }

  async createPaymentIntent(
    userId: string,
    email: string,
    planId: string,
    countryCode: string,
    amount: number,
    iccid?: string,
    currency?: string,
  ): Promise<{
    clientSecret: string;
    intentId: string;
    customerId: string | null;
  }> {
    try {
      // For real-world apps, you'd find or create the Stripe Customer here.
      // For this demo, we'll just create the intent directly.
      const selectedCurrency = currency?.toLowerCase() === 'eur' ? 'eur' : 'usd';
      const intent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // convert to cents
        currency: selectedCurrency,
        receipt_email: email,
        metadata: {
          userId,
          planId,
          countryCode,
          amount: amount.toString(),
          currency: selectedCurrency.toUpperCase(),
          ...(iccid ? { targetIccid: iccid } : {}),
        },
      });

      return {
        clientSecret: intent.client_secret || '',
        intentId: intent.id,
        customerId: intent.customer as string | null,
      };
    } catch (err) {
      this.logger.error(
        `Stripe PaymentIntent creation failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to initialize Payment Intent.');
    }
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err) {
      this.logger.error(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Webhook verification failed.');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const metadata = session.metadata;

      if (
        !metadata ||
        !metadata.userId ||
        !metadata.planId ||
        !metadata.countryCode
      ) {
        this.logger.error(
          `Missing metadata in checkout session completed: ${session.id}`,
        );
        return;
      }

      const userId = metadata.userId;
      const planId = metadata.planId;
      const countryCode = metadata.countryCode;
      const amountPaid = parseFloat(metadata.amount || '0');
      const targetIccid = metadata.targetIccid;

      // Create Order in PENDING status (idempontency check using stripeSessionId)
      const existingOrder = await this.prisma.esimOrder.findUnique({
        where: { stripeSessionId: session.id },
      });

      if (existingOrder) {
        this.logger.log(
          `Order already registered for Stripe session: ${session.id}`,
        );
        return;
      }

      let esimProfileId: string | undefined;
      if (targetIccid) {
        const profile = await this.prisma.esimProfile.findUnique({
          where: { iccid: targetIccid },
        });
        if (profile) {
          esimProfileId = profile.id;
        }
      }

      const order = await this.prisma.esimOrder.create({
        data: {
          userId,
          planId,
          countryCode,
          status: OrderStatus.PENDING,
          amountPaid,
          stripeSessionId: session.id,
          esimProfileId: esimProfileId || null,
        },
      });

      this.logger.log(
        `Created PENDING order ${order.id} for user ${userId}. Provisioning eSIM inline.`,
      );
      try {
        await this.esimProvisionService.provision(
          order.id,
          planId,
          session.customer_details?.email || session.customer_email || '',
          targetIccid,
        );
      } catch (err) {
        this.logger.error(
          `Inline provisioning failed for order ${order.id}: ${(err as Error).message}`,
        );
      }
    } else if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const metadata = intent.metadata;

      if (
        !metadata ||
        !metadata.userId ||
        !metadata.planId ||
        !metadata.countryCode
      ) {
        this.logger.error(
          `Missing metadata in payment intent succeeded: ${intent.id}`,
        );
        return;
      }

      const userId = metadata.userId;
      const planId = metadata.planId;
      const countryCode = metadata.countryCode;
      const amountPaid = parseFloat(metadata.amount || '0');
      const targetIccid = metadata.targetIccid;

      // Create Order in PENDING status (idempontency check using stripeSessionId)
      const existingOrder = await this.prisma.esimOrder.findUnique({
        where: { stripeSessionId: intent.id },
      });

      if (existingOrder) {
        this.logger.log(
          `Order already registered for Stripe intent: ${intent.id}`,
        );
        return;
      }

      let esimProfileId: string | undefined;
      if (targetIccid) {
        const profile = await this.prisma.esimProfile.findUnique({
          where: { iccid: targetIccid },
        });
        if (profile) {
          esimProfileId = profile.id;
        }
      }

      const order = await this.prisma.esimOrder.create({
        data: {
          userId,
          planId,
          countryCode,
          status: OrderStatus.PENDING,
          amountPaid,
          stripeSessionId: intent.id,
          esimProfileId: esimProfileId || null,
        },
      });

      this.logger.log(
        `Created PENDING order ${order.id} for user ${userId} via PaymentIntent. Provisioning eSIM inline.`,
      );
      try {
        await this.esimProvisionService.provision(
          order.id,
          planId,
          intent.receipt_email || '',
          targetIccid,
        );
      } catch (err) {
        this.logger.error(
          `Inline provisioning failed for order ${order.id} via PaymentIntent: ${(err as Error).message}`,
        );
      }
    }
  }

  async getOrderStatusBySessionId(sessionId: string): Promise<any> {
    const order = await this.prisma.esimOrder.findFirst({
      where: {
        OR: [{ stripeSessionId: sessionId }, { id: sessionId }],
      },
      include: {
        esimProfile: true,
      },
    });
    if (!order) {
      throw new BadRequestException('Order not found.');
    }
    return order;
  }

  async getOrdersByUserId(userId: string): Promise<any[]> {
    const profiles = await this.prisma.esimProfile.findMany({
      where: { userId },
      include: {
        orders: {
          where: { status: OrderStatus.PROVISIONED },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const mapped: any[] = [];
    for (const p of profiles) {
      const latestOrder = p.orders[0];
      let planName = 'eSIM Plan';
      let dataGb = 5.0; // Default fallback

      if (latestOrder) {
        try {
          const plans = await this.provider.getPlans(latestOrder.countryCode);
          const matchedPlan = plans.find(plan => plan.id === latestOrder.planId);
          if (matchedPlan) {
            planName = matchedPlan.name;
            dataGb = matchedPlan.dataGb;
          }
        } catch (err) {
          this.logger.warn(`Could not resolve plan name from provider: ${err.message}`);
        }
      }

      mapped.push({
        id: p.id,
        iccid: p.iccid,
        qrCodeUrl: p.qrCodeUrl,
        smDpAddress: p.smDpAddress,
        activationCode: p.activationCode,
        status: p.status,
        statusString: p.statusString,
        planId: latestOrder?.planId || 'unknown_plan',
        planName,
        dataGb,
        countryCode: latestOrder?.countryCode || 'US',
        dataRemainingBytes: Number(p.dataRemainingBytes),
        dataTotalBytes: Number(p.dataTotalBytes),
        dataUsedBytes: Number(p.dataUsedBytes),
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }

    return mapped;
  }

  async getEsimDetails(userId: string, iccid: string): Promise<any> {
    // 1. Verify eSIM belongs to the user
    const profile = await this.prisma.esimProfile.findUnique({
      where: { iccid },
      include: {
        orders: {
          where: { status: OrderStatus.PROVISIONED },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!profile || profile.userId !== userId) {
      throw new BadRequestException('eSIM profile not found or access denied.');
    }

    const latestOrder = profile.orders[0];
    let planName = 'eSIM Plan';
    let dataGb = 5.0;

    if (latestOrder) {
      try {
        const plans = await this.provider.getPlans(latestOrder.countryCode);
        const matchedPlan = plans.find(plan => plan.id === latestOrder.planId);
        if (matchedPlan) {
          planName = matchedPlan.name;
          dataGb = matchedPlan.dataGb;
        }
      } catch (err) {
        this.logger.warn(`Could not resolve plan name from provider: ${err.message}`);
      }
    }

    // 2. Fetch live details from carrier via Yesim API
    try {
      const carrierDetails = await this.provider.getEsimDetails(iccid);
      
      // Update local database with live details
      await this.prisma.esimProfile.update({
        where: { iccid },
        data: {
          status: carrierDetails.status,
          statusString: carrierDetails.statusString || 'Released',
          dataTotalBytes: carrierDetails.dataTotalBytes ? Math.round(carrierDetails.dataTotalBytes) : 0,
          dataUsedBytes: carrierDetails.dataUsedBytes ? Math.round(carrierDetails.dataUsedBytes) : 0,
          dataRemainingBytes: carrierDetails.dataRemainingBytes ? Math.round(carrierDetails.dataRemainingBytes) : 0,
          expiresAt: carrierDetails.expiresAt,
        },
      });

      return {
        id: profile.id,
        iccid: profile.iccid,
        qrCodeUrl: profile.qrCodeUrl,
        smDpAddress: profile.smDpAddress,
        activationCode: profile.activationCode,
        status: carrierDetails.status,
        statusString: carrierDetails.statusString || 'Released',
        dataTotalBytes: carrierDetails.dataTotalBytes,
        dataUsedBytes: carrierDetails.dataUsedBytes,
        dataRemainingBytes: carrierDetails.dataRemainingBytes,
        expiresAt: carrierDetails.expiresAt,
        planId: latestOrder?.planId || 'unknown_plan',
        planName,
        dataGb,
        countryCode: latestOrder?.countryCode || 'US',
      };
    } catch (err) {
      this.logger.error(`Failed to fetch carrier details for ICCID ${iccid}: ${(err as Error).message}`);
      // Fallback to database profile info on carrier lookup failure
      return {
        id: profile.id,
        iccid: profile.iccid,
        qrCodeUrl: profile.qrCodeUrl,
        smDpAddress: profile.smDpAddress,
        activationCode: profile.activationCode,
        status: profile.status,
        statusString: profile.statusString,
        dataTotalBytes: Number(profile.dataTotalBytes),
        dataUsedBytes: Number(profile.dataUsedBytes),
        dataRemainingBytes: Number(profile.dataRemainingBytes),
        expiresAt: profile.expiresAt,
        planId: latestOrder?.planId || 'unknown_plan',
        planName,
        dataGb,
        countryCode: latestOrder?.countryCode || 'US',
      };
    }
  }

  async handleYesimWebhook(payload: any): Promise<void> {
    const iccid = payload.iccid;
    if (!iccid) {
      this.logger.warn('Yesim webhook received without iccid');
      return;
    }

    this.logger.log(`Received Yesim webhook for ICCID: ${iccid}, Type: ${payload.type}`);

    try {
      const details = await this.provider.getEsimDetails(iccid);
      await this.prisma.esimProfile.update({
        where: { iccid },
        data: {
          status: details.status,
          statusString: details.statusString || 'Released',
          dataTotalBytes: details.dataTotalBytes ? Math.round(details.dataTotalBytes) : 0,
          dataUsedBytes: details.dataUsedBytes ? Math.round(details.dataUsedBytes) : 0,
          dataRemainingBytes: details.dataRemainingBytes ? Math.round(details.dataRemainingBytes) : 0,
          expiresAt: details.expiresAt,
        },
      });
      this.logger.log(`Successfully updated eSIM profile for ICCID ${iccid} via webhook details`);
    } catch (err) {
      this.logger.error(`Failed to update eSIM profile for ICCID ${iccid} via webhook: ${(err as Error).message}`);
    }
  }
}
