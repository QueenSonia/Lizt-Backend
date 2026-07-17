import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PaymentReconciliationService } from '../src/payments/payment-reconciliation.service';

/**
 * Run the payment reconciliation sweep on demand.
 *
 * Same code path the half-hourly cron runs — this just triggers it now instead
 * of waiting for the next window. Use it to:
 *   - rescue a stuck payment (gateway took the money, our DB says UNPAID)
 *     without waiting up to 30 minutes;
 *   - prove the safety net end-to-end on dev: disable webhooks, pay, close the
 *     tab, run this, watch the invoice get credited.
 *
 * Supersedes scripts/manual-verify-payment.ts, which only ever handled the
 * offer-letter lane and required you to already know the reference. This finds
 * every unresolved intent across the renewal, ad-hoc and payment-plan lanes.
 *
 * Safe to run repeatedly: every processor it dispatches to is idempotent on the
 * payment reference.
 *
 * Usage:
 *   npm run script:reconcile-payments
 */
async function main() {
  console.log('🔍 Running payment reconciliation sweep...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const service = app.get(PaymentReconciliationService);
    await service.reconcilePendingIntents();
    console.log(
      '\n✅ Sweep complete. See the logs above for per-intent outcomes.',
    );
    console.log(
      '   No per-intent lines = nothing was due. That is a good sign, not a failure.',
    );
  } catch (error) {
    console.error('\n❌ Sweep failed:', (error as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
