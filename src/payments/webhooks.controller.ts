import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Ip,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { Public } from '../auth/public.decorator';
import { PaymentService } from './payment.service';
import { PaystackLogger } from './paystack-logger.service';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

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
    @InjectQueue('paystack-webhooks')
    private readonly webhookQueue: Queue,
  ) { }

  /**
   * Handle Paystack webhook events
   *
   * This endpoint receives payment notifications from Paystack.
   * It validates the webhook signature, whitelists IPs, and queues jobs for processing.
   *
   * @Public - This endpoint must be accessible without authentication
   */
  @Public()
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async handlePaystackWebhook(
    @Req() req: Request,
    @Headers('x-paystack-signature') signature: string,
    @Body() body: any,
    @Ip() ip: string,
  ): Promise<{ status: string; message?: string }> {
    try {
      // 1. IP Whitelisting (Defense in Depth)
      const clientIp = req.headers['x-forwarded-for'] || ip;
      const normalizedIp = Array.isArray(clientIp)
        ? clientIp[0]
        : (clientIp as string).split(',')[0].trim();

      if (!PAYSTACK_IPS.includes(normalizedIp) && process.env.NODE_ENV === 'production') {
        this.paystackLogger.error('Unauthorized webhook IP', {
          ip: normalizedIp,
          event: body.event,
        });
        // We still return 200 OK to avoid leaking information to potential attackers,
        // but we don't process the request.
        return { status: 'success', message: 'IP check failed (logged)' };
      }

      // 2. Signature Validation (Requirement 5.2)
      if (!signature) {
        this.paystackLogger.error('Webhook signature missing', {
          event: body.event,
        });
        return { status: 'error', message: 'Signature missing' };
      }

      const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');

      if (!secretKey) {
        this.paystackLogger.error('PAYSTACK_SECRET_KEY not configured', {});
        throw new Error('Paystack secret key not configured');
      }

      // Paystack recommendation: Use raw body for HMAC verification
      const rawBody = req['rawBody'] || JSON.stringify(body);
      const hash = crypto
        .createHmac('sha512', secretKey)
        .update(rawBody)
        .digest('hex');

      if (hash !== signature) {
        this.paystackLogger.error('Invalid webhook signature', {
          event: body.event,
          reference: body.data?.reference,
          ip: normalizedIp,
        });
        return { status: 'error', message: 'Invalid signature' };
      }

      // 3. Asynchronous Job Queuing (Paystack Recommendation)
      // We acknowledge immediately (200 OK) and process in the background
      if (body.event === 'charge.success') {
        this.paystackLogger.info('Queuing charge.success webhook', {
          reference: body.data.reference,
          amount: body.data.amount,
        });

        await this.webhookQueue.add(
          'handle-event',
          {
            event: body.event,
            data: body.data,
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: true,
          },
        );
      } else {
        this.paystackLogger.info('Ignored non-critical webhook event', {
          event: body.event,
        });
      }

      // Return 200 OK immediately
      return { status: 'success' };
    } catch (error) {
      this.paystackLogger.error('Webhook error', {
        error: error.message,
        event: body?.event,
      });

      // Always return 200 OK to Paystack
      return { status: 'error', message: error.message };
    }
  }
}
