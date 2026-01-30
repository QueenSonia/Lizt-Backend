import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { Public } from '../auth/public.decorator';
import { PaymentService } from './payment.service';
import { PaystackLogger } from './paystack-logger.service';
import { ConfigService } from '@nestjs/config';

/**
 * Webhook controller for handling Paystack payment notifications
 *
 * Requirements:
 * - TR-4: POST /api/webhooks/paystack endpoint
 * - US-5: System Processes Paystack Payments
 * - NFR-1: Payment Security (webhook signature validation)
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly paystackLogger: PaystackLogger,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Handle Paystack webhook events
   *
   * This endpoint receives payment notifications from Paystack.
   * It validates the webhook signature and processes successful payments.
   *
   * @Public - This endpoint must be accessible without authentication
   *
   * Requirements:
   * - 5.1: System receives Paystack webhook on payment success
   * - 5.2: System validates webhook signature using Paystack secret key
   * - 5.3: System extracts transaction data
   * - 5.4: System updates payment record status to "completed"
   * - 5.7: System logs all webhook events
   */
  @Public()
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async handlePaystackWebhook(
    @Req() req: Request,
    @Headers('x-paystack-signature') signature: string,
    @Body() body: any,
  ): Promise<{ status: string; message?: string }> {
    try {
      // Log webhook receipt
      this.paystackLogger.info('Webhook received', {
        event: body.event,
        reference: body.data?.reference,
        amount: body.data?.amount,
        status: body.data?.status,
      });

      // Validate webhook signature (Requirement 5.2)
      if (!signature) {
        this.paystackLogger.error('Webhook signature missing', {
          event: body.event,
        });
        throw new UnauthorizedException('Webhook signature missing');
      }

      const webhookSecret = this.configService.get<string>(
        'PAYSTACK_WEBHOOK_SECRET',
      );

      if (!webhookSecret) {
        this.paystackLogger.error('PAYSTACK_WEBHOOK_SECRET not configured', {});
        throw new Error('Webhook secret not configured');
      }

      // Compute HMAC SHA512 hash
      const hash = crypto
        .createHmac('sha512', webhookSecret)
        .update(JSON.stringify(body))
        .digest('hex');

      // Compare with signature
      if (hash !== signature) {
        this.paystackLogger.error('Invalid webhook signature', {
          event: body.event,
          reference: body.data?.reference,
        });
        throw new UnauthorizedException('Invalid webhook signature');
      }

      // Check for duplicate webhooks (idempotency)
      // This is handled in PaymentService.processSuccessfulPayment()

      // Handle charge.success event (Requirement 5.1)
      if (body.event === 'charge.success') {
        this.paystackLogger.info('Processing charge.success event', {
          reference: body.data.reference,
          amount: body.data.amount,
        });

        // Process successful payment (Requirement 5.4)
        await this.paymentService.processSuccessfulPayment(body.data);

        this.paystackLogger.info('Webhook processed successfully', {
          reference: body.data.reference,
        });
      } else {
        this.paystackLogger.info('Webhook event ignored', {
          event: body.event,
          reference: body.data?.reference,
        });
      }

      // Always return 200 OK to Paystack (even on errors)
      // This prevents Paystack from retrying the webhook
      return { status: 'success' };
    } catch (error) {
      // Log error but still return 200 OK to Paystack
      this.paystackLogger.error('Webhook processing error', {
        error: error.message,
        stack: error.stack,
        event: body?.event,
        reference: body?.data?.reference,
      });

      // Return 200 OK even on errors (Paystack requirement)
      // This prevents Paystack from retrying failed webhooks
      return { status: 'error', message: error.message };
    }
  }
}
