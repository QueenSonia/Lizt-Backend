import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PaystackService } from '../src/payments/paystack.service';
import { PaymentService } from '../src/payments/payment.service';

/**
 * Manual Payment Verification Script
 *
 * Use this to manually verify and process a stuck payment
 * that succeeded on Paystack but webhook never arrived.
 *
 * Usage:
 *   npm run ts-node scripts/manual-verify-payment.ts LIZT_1771582415248_023b7a0f
 */

async function verifyAndProcessPayment(reference: string) {
  console.log('🔍 Starting manual payment verification...');
  console.log(`Reference: ${reference}\n`);

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const paystackService = app.get(PaystackService);
    const paymentService = app.get(PaymentService);

    // Step 1: Verify with Paystack
    console.log('📡 Verifying with Paystack API...');
    const verification = await paystackService.verifyTransaction(reference);

    console.log('\n✅ Paystack Response:');
    console.log(`   Status: ${verification.data.status}`);
    console.log(`   Amount: ₦${verification.data.amount / 100}`);
    console.log(`   Channel: ${verification.data.channel}`);
    console.log(`   Paid At: ${verification.data.paid_at}`);
    console.log(`   Gateway Response: ${verification.data.gateway_response}`);

    // Step 2: Check if payment succeeded
    if (verification.data.status !== 'success') {
      console.log('\n❌ Payment not successful on Paystack');
      console.log(`   Current status: ${verification.data.status}`);
      console.log('   No action taken.');
      return;
    }

    // Step 3: Process the payment
    console.log('\n⚙️  Processing payment...');
    await paymentService.processSuccessfulPayment(verification.data);

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
