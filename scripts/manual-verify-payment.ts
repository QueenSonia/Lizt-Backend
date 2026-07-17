import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { GatewayRegistryService } from '../src/payments/gateway/gateway-registry.service';
import { PaymentService } from '../src/payments/payment.service';

/**
 * Manual Payment Verification Script
 *
 * Use this to manually verify and process a stuck payment that succeeded on
 * the payment gateway but whose webhook never arrived. Gateway-agnostic: the
 * registry probes the active gateway first and falls back through legacy
 * adapters (Paystack) on a definitive not-found — exactly the runtime rule.
 *
 * Usage:
 *   npm run ts-node scripts/manual-verify-payment.ts LIZT_1771582415248_023b7a0f
 */

async function verifyAndProcessPayment(reference: string) {
  console.log('🔍 Starting manual payment verification...');
  console.log(`Reference: ${reference}\n`);

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const gatewayRegistry = app.get(GatewayRegistryService);
    const paymentService = app.get(PaymentService);

    // Step 1: Verify with the gateway
    console.log('📡 Verifying with the payment gateway...');
    const verification = await gatewayRegistry.verifyByReference(reference);

    console.log('\n✅ Gateway Response:');
    console.log(`   Gateway: ${verification.gateway}`);
    console.log(
      `   Status: ${verification.status} (raw: ${verification.rawStatus})`,
    );
    console.log(`   Amount: ₦${verification.amountNaira}`);
    console.log(`   Channel: ${verification.channel}`);
    console.log(`   Paid At: ${verification.paidAt?.toISOString() ?? '—'}`);
    console.log(`   Gateway Response: ${verification.gatewayResponse ?? '—'}`);

    // Step 2: Check if payment succeeded
    if (verification.status !== 'success') {
      console.log('\n❌ Payment not successful on the gateway');
      console.log(
        `   Current status: ${verification.status} (raw: ${verification.rawStatus})`,
      );
      if (verification.moneyReceived) {
        console.log(
          '   ⚠️ Money WAS received without a clean success (partial/over-payment) — reconcile on the gateway dashboard.',
        );
      }
      console.log('   No action taken.');
      return;
    }

    // Step 3: Process the payment (offer-letter lane)
    console.log('\n⚙️  Processing payment...');
    await paymentService.processSuccessfulPayment(verification);

    console.log('\n✅ Payment processed successfully!');
    console.log('   - Payment status updated to COMPLETED');
    console.log('   - Offer letter amounts updated');
    console.log('   - Receipt generated');
    console.log('   - Notifications sent');
    console.log('   - Property secured (if fully paid)');
  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.message?.includes('Payment not found')) {
      console.log('\n💡 Tip: Check if the reference is correct');
    } else if (error.message?.includes('already completed')) {
      console.log('\n💡 This payment was already processed');
    } else {
      console.log('\n💡 Full error:', error);
    }
  } finally {
    await app.close();
  }
}

// Get reference from command line argument
const reference = process.argv[2];

if (!reference) {
  console.error('❌ Error: Payment reference is required');
  console.log('\nUsage:');
  console.log('  npm run ts-node scripts/manual-verify-payment.ts <reference>');
  console.log('\nExample:');
  console.log(
    '  npm run ts-node scripts/manual-verify-payment.ts LIZT_1771582415248_023b7a0f',
  );
  process.exit(1);
}

verifyAndProcessPayment(reference)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
