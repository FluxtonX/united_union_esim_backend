import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import Stripe from 'stripe';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('esim-provision') private readonly provisionQueue: Queue,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_API_KEY || 'sk_test_mock', {
      apiVersion: '2025-01-27-preview' as any, // Matches latest Stripe library version
    });
  }

  async createCheckoutSession(
    userId: string,
    email: string,
    planId: string,
    countryCode: string,
    amount: number,
  ): Promise<{ sessionId: string; url: string | null }> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
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
        customer_email: email,
        metadata: {
          userId,
          planId,
          countryCode,
          amount: amount.toString(),
        },
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/checkout/cancel`,
      });

      return {
        sessionId: session.id,
        url: session.url,
      };
    } catch (err) {
      this.logger.error(`Stripe session creation failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to initialize payment gateway.');
    }
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Webhook verification failed.');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata;

      if (!metadata || !metadata.userId || !metadata.planId || !metadata.countryCode) {
        this.logger.error(`Missing metadata in checkout session completed: ${session.id}`);
        return;
      }

      const userId = metadata.userId;
      const planId = metadata.planId;
      const countryCode = metadata.countryCode;
      const amountPaid = parseFloat(metadata.amount || '0');

      // Create Order in PENDING status (idempontency check using stripeSessionId)
      const existingOrder = await this.prisma.esimOrder.findUnique({
        where: { stripeSessionId: session.id },
      });

      if (existingOrder) {
        this.logger.log(`Order already registered for Stripe session: ${session.id}`);
        return;
      }

      const order = await this.prisma.esimOrder.create({
        data: {
          userId,
          planId,
          countryCode,
          status: OrderStatus.PENDING,
          amountPaid,
          stripeSessionId: session.id,
        },
      });

      this.logger.log(`Created PENDING order ${order.id} for user ${userId}. Queueing provisioning job.`);

      // Add background provisioning job to BullMQ
      await this.provisionQueue.add(
        'provision-esim',
        {
          orderId: order.id,
          userId,
          planId,
          email: session.customer_details?.email || session.customer_email || '',
        },
        {
          attempts: 3, // Retry up to 3 times on failure
          backoff: {
            type: 'exponential',
            delay: 5000, // Wait 5s, 10s, 20s
          },
        },
      );
    }
  }
}
