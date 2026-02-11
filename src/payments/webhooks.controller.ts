import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Ip,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Public } from '../auth/public.decorator';
import { PaymentService } from './payment.service';
import { PaystackLogger } from './paystack-logger.service';
import { ConfigService } from '@nestjs/config';

// Paystack's official webhook source IP addresses
const PAYSTACK_IPS = ['52.31.139.75', '52.49.173.169', '52.214.14.220'];

/**
 * Webhook controller for handling Paystack payment notifications
 *
 * Requirements:
 * - TR-4: POST /api/webhooks/paystack endpoint
 * - US-5: System Processes Paystack Payments
 * - NFR-1: Payment Security (webhook signature validation & IP whitelisting)
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
   * Processes webhooks synchronously (no queue)
   */
  @Public()
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async handlePaystackWebhook(
    @Req() req: any,
    @Headers('x-paystack-signature') signature: string,
    @Body() body: any,
    @Ip() ip: string,
  ): Promise<{ status: string; message?: string }> {
    try {
      // 1. IP Whitelisting (Defense in Depth)
      const clientIp = ip;

      if (
        !PAYSTACK_IPS.includes(clientIp) &&
        process.env.NODE_ENV === 'production'
      ) {
        this.paystackLogger.error('Unauthorized webhook IP blocked', {
          detected_ip: clientIp,
          all_headers: req.headers,
          event: body?.event,
        });
        return { status: 'success', message: 'IP check failed (logged)' };
      }

      // 2. Signature Validation
      if (!signature) {
        this.paystackLogger.error('Webhook signature missing', {
          event: body?.event,
        });
        return { status: 'error', message: 'Signature missing' };
      }

      const rawBody = req.rawBody
        ? req.rawBody.toString('utf8')
        : body
          ? JSON.stringify(body)
          : '';

      const secretKey =
        this.configService.get<string>('PAYSTACK_SECRET_KEY') ||
        this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET');

      if (!secretKey) {
        this.paystackLogger.error(
          'Paystack secret key not configured in environment',
          {
            available_keys: Object.keys(process.env).filter((k) =>
              k.includes('PAYSTACK'),
            ),
          },
        );
        throw new Error('Paystack secret key not configured');
      }

      const hash = crypto
        .createHmac('sha512', secretKey)
        .update(rawBody)
        .digest('hex');

      if (hash !== signature) {
        this.paystackLogger.error('Invalid webhook signature detected', {
          event: body?.event,
          reference: body?.data?.reference,
          received_sig_prefix: signature?.substring(0, 8),
          calculated_hash_prefix: hash?.substring(0, 8),
        });
        return { status: 'error', message: 'Invalid signature' };
      }

      // 3. Process webhook synchronously
      if (body.event === 'charge.success') {
        this.paystackLogger.info('Processing charge.success webhook', {
          reference: body.data.reference,
          amount: body.data.amount,
        });

        try {
          await this.paymentService.processSuccessfulPayment(body.data);
          this.paystackLogger.info('Webhook processed successfully', {
            reference: body.data.reference,
          });
        } catch (error) {
          // Log but don't fail the webhook response
          // Paystack will retry if we return non-200
          this.paystackLogger.error('Error processing webhook', {
            reference: body.data.reference,
            error: error.message,
          });
        }
      } else {
        this.paystackLogger.info('Webhook event received', {
          event: body.event,
        });
      }

      return { status: 'success' };
    } catch (error) {
      this.paystackLogger.error('Webhook endpoint error', {
        error: error.message,
        stack: error.stack,
      });
      return { status: 'error', message: error.message };
    }
  }
}
