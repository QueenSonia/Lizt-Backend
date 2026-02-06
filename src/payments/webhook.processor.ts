import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaystackLogger } from './paystack-logger.service';

export interface WebhookJobData {
  event: string;
  data: any;
}

@Processor('paystack-webhooks')
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly paystackLogger: PaystackLogger,
  ) {}

  @Process('handle-event')
  async handleWebhookEvent(job: Job<WebhookJobData>): Promise<void> {
    const { event, data } = job.data;

    this.logger.log(
      `Processing background webhook event: ${event} for reference: ${data.reference}, attempt: ${job.attemptsMade + 1}`,
    );

    try {
      if (event === 'charge.success') {
        // Check if payment is already completed before processing
        // This reduces unnecessary processing and potential lock contention
        const payment = await this.paymentService.findByReference(
          data.reference,
        );
        if (payment?.status === 'completed') {
          this.logger.log(
            `Payment ${data.reference} already completed, skipping webhook processing`,
          );
          return;
        }

        await this.paymentService.processSuccessfulPayment(data);
        this.logger.log(
          `Successfully processed charge.success for reference: ${data.reference}`,
        );
      } else {
        this.logger.warn(
          `Received unhandled event type in background: ${event}`,
        );
      }
    } catch (error) {
      // Don't retry if it's a lock contention error - another process handled it
      if (
        error.message?.includes('could not obtain lock') ||
        error.code === '55P03'
      ) {
        this.logger.log(
          `Lock contention for ${data.reference}, another process is handling it`,
        );
        return;
      }

      this.paystackLogger.error('Webhook processing job failed', {
        event,
        reference: data.reference,
        error: error.message,
        stack: error.stack,
      });
      this.logger.error(
        `Error processing webhook job: ${error.message}`,
        error.stack,
      );
      throw error; // Re-throw to trigger Bull retry if needed
    }
  }
}
