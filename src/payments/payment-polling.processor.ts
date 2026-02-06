import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PaystackService } from './paystack.service';
import { PaymentService } from './payment.service';
import { PaystackLogger } from './paystack-logger.service';

export interface PaymentPollingJobData {
  paymentId: string;
  reference: string;
}

@Processor('payment-polling')
export class PaymentPollingProcessor {
  private readonly logger = new Logger(PaymentPollingProcessor.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly paymentService: PaymentService,
    private readonly paystackLogger: PaystackLogger,
  ) {}

  @Process('verify-payment')
  async handlePaymentVerification(
    job: Job<PaymentPollingJobData>,
  ): Promise<{ processed: boolean; failed?: boolean }> {
    const { paymentId, reference } = job.data;

    this.logger.log(
      `Processing payment verification job for reference: ${reference}, attempt: ${job.attemptsMade + 1}`,
    );

    try {
      // Early check: if payment is already completed, skip verification
      const existingPayment =
        await this.paymentService.findByReference(reference);
      if (existingPayment?.status === 'completed') {
        this.logger.log(
          `Payment ${reference} already completed, skipping polling verification`,
        );
        return { processed: true };
      }

      // Call Paystack Verify Transaction API
      const verification =
        await this.paystackService.verifyTransaction(reference);

      await this.paystackLogger.info('Polling verification', {
        reference,
        status: verification.data.status,
        amount: verification.data.amount,
        attempt: job.attemptsMade + 1,
        payment_id: paymentId,
      });

      if (verification.data.status === 'success') {
        // Process payment if not already processed by webhook
        const payment = await this.paymentService.findById(paymentId);

        if (payment.status === 'pending') {
          await this.paymentService.processSuccessfulPayment(verification.data);
          await this.paystackLogger.info('Payment processed via polling', {
            reference,
            payment_id: paymentId,
          });
          this.logger.log(
            `Payment ${paymentId} processed successfully via polling`,
          );
        } else {
          await this.paystackLogger.info(
            'Payment already processed by webhook',
            {
              reference,
              payment_id: paymentId,
              current_status: payment.status,
            },
          );
          this.logger.log(
            `Payment ${paymentId} already processed with status: ${payment.status}`,
          );
        }

        // Job complete, don't retry
        return { processed: true };
      } else if (verification.data.status === 'failed') {
        // Mark payment as failed
        await this.paymentService.markAsFailed(paymentId, verification.data);
        await this.paystackLogger.info('Payment marked as failed via polling', {
          reference,
          payment_id: paymentId,
        });
        this.logger.log(`Payment ${paymentId} marked as failed`);
        return { processed: true, failed: true };
      }

      // Status is still 'pending', will retry
      this.logger.log(
        `Payment ${paymentId} still pending, will retry (attempt ${job.attemptsMade + 1})`,
      );
      throw new Error('Payment still pending');
    } catch (error) {
      // Don't retry if it's a lock contention error
      if (
        error.message?.includes('could not obtain lock') ||
        error.code === '55P03'
      ) {
        this.logger.log(
          `Lock contention for ${reference}, another process is handling it`,
        );
        return { processed: true };
      }

      await this.paystackLogger.error('Polling error', {
        reference,
        payment_id: paymentId,
        error: error.message,
        attempt: job.attemptsMade + 1,
      });

      this.logger.error(
        `Error polling payment ${paymentId}: ${error.message}`,
        error.stack,
      );

      // Re-throw to trigger retry
      throw error;
    }
  }
}
