import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';

@ApiTags('Payments')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe checkout session for an eSIM plan' })
  @ApiResponse({ status: 200, description: 'Checkout session created successfully.' })
  async createCheckout(
    @GetUser('id') userId: string,
    @GetUser('email') email: string,
    @Body() dto: CheckoutDto,
  ): Promise<{ success: boolean; data: any }> {
    const session = await this.paymentService.createCheckoutSession(
      userId,
      email,
      dto.planId,
      dto.countryCode,
      dto.amount,
    );
    return {
      success: true,
      data: session,
    };
  }

  @Post('intent')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe PaymentIntent for native mobile checkout' })
  @ApiResponse({ status: 200, description: 'PaymentIntent created successfully.' })
  async createIntent(
    @GetUser('id') userId: string,
    @GetUser('email') email: string,
    @Body() dto: CheckoutDto,
  ): Promise<{ success: boolean; data: any }> {
    const intentData = await this.paymentService.createPaymentIntent(
      userId,
      email,
      dto.planId,
      dto.countryCode,
      dto.amount,
    );
    return {
      success: true,
      data: intentData,
    };
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe Webhook Listener (Raw Body Verified)' })
  @ApiHeader({ name: 'stripe-signature', description: 'Stripe webhook signature', required: true })
  async handleWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    if (!signature) {
      throw new BadRequestException('Stripe signature header is missing');
    }

    // Retrieve rawBody buffer attached by NestJS rawBody option
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Raw request body is required for signature verification');
    }

    await this.paymentService.handleWebhook(rawBody, signature);

    return { received: true };
  }
}
