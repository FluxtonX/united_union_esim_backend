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
      apiVersion: '2024-12-18.acacia' as any,
    });
  }

  async createCheckoutSession(
    userId: string | undefined,
    email: string | undefined,
    planId: string,
    countryCode: string,
    amount: number,
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
        customer_email: finalEmail,
        metadata: {
          userId: finalUserId,
          planId,
          countryCode,
          amount: amount.toString(),
        },
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/checkout/cancel`,
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

  async createPaymentIntent(
    userId: string,
    email: string,
    planId: string,
    countryCode: string,
    amount: number,
  ): Promise<{ clientSecret: string; intentId: string; customerId: string | null }> {
    try {
      // For real-world apps, you'd find or create the Stripe Customer here.
      // For this demo, we'll just create the intent directly.
      const intent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // convert to cents
        currency: 'usd',
        receipt_email: email,
        metadata: {
          userId,
          planId,
          countryCode,
          amount: amount.toString(),
        },
      });

      return {
        clientSecret: intent.client_secret || '',
        intentId: intent.id,
        customerId: intent.customer as string | null,
      };
    } catch (err) {
      this.logger.error(`Stripe PaymentIntent creation failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to initialize Payment Intent.');
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
    } else if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const metadata = intent.metadata;

      if (!metadata || !metadata.userId || !metadata.planId || !metadata.countryCode) {
        this.logger.error(`Missing metadata in payment intent succeeded: ${intent.id}`);
        return;
      }

      const userId = metadata.userId;
      const planId = metadata.planId;
      const countryCode = metadata.countryCode;
      const amountPaid = parseFloat(metadata.amount || '0');

      // Create Order in PENDING status (idempontency check using stripeSessionId)
      const existingOrder = await this.prisma.esimOrder.findUnique({
        where: { stripeSessionId: intent.id }, // Storing intent.id in stripeSessionId field
      });

      if (existingOrder) {
        this.logger.log(`Order already registered for Stripe intent: ${intent.id}`);
        return;
      }

      const order = await this.prisma.esimOrder.create({
        data: {
          userId,
          planId,
          countryCode,
          status: OrderStatus.PENDING,
          amountPaid,
          stripeSessionId: intent.id, // Using the same field for PaymentIntent ID
        },
      });

      this.logger.log(`Created PENDING order ${order.id} for user ${userId} via PaymentIntent. Queueing provisioning job.`);

      await this.provisionQueue.add(
        'provision-esim',
        {
          orderId: order.id,
          userId,
          planId,
          email: intent.receipt_email || '',
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );
    }
  }

  async getOrderStatusBySessionId(sessionId: string): Promise<any> {
    const order = await this.prisma.esimOrder.findFirst({
      where: {
        OR: [
          { stripeSessionId: sessionId },
          { id: sessionId }
        ]
      },
    });
    if (!order) {
      throw new BadRequestException('Order not found.');
    }
    return order;
  }
}
