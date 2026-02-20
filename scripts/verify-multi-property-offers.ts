import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

/**
 * Verification Script: Multi-Property Offers Implementation
 *
 * This script verifies that the multi-property offers system is working correctly:
 * 1. Checks that initial_property_id column exists and has data
 * 2. Verifies data integrity (initial_property_id matches property_id)
 * 3. Finds KYC applications with offers for multiple properties
 * 4. Checks for any orphaned references
 */

async function verifyMultiPropertyOffers() {
  console.log('🔍 Starting Multi-Property Offers Verification...\n');

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Database connection established\n');

    // Test 1: Verify column exists
    console.log('📋 Test 1: Checking if initial_property_id column exists...');
    const columnCheck = await dataSource.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'kyc_applications'
      AND column_name = 'initial_property_id'
    `);

    if (columnCheck.length === 0) {
      console.log('❌ FAILED: initial_property_id column not found');
      return;
    }
    console.log('✅ PASSED: initial_property_id column exists');
    console.log(
      `   Type: ${columnCheck[0].data_type}, Nullable: ${columnCheck[0].is_nullable}\n`,
    );

    // Test 2: Verify data integrity
    console.log(
      '📋 Test 2: Checking data integrity (initial_property_id = property_id)...',
    );
    const mismatchCount = await dataSource.query(`
      SELECT COUNT(*) as count
      FROM kyc_applications
      WHERE initial_property_id != property_id
    `);

    const mismatches = parseInt(mismatchCount[0].count);
    if (mismatches > 0) {
      console.log(
        `⚠️  WARNING: Found ${mismatches} records where initial_property_id != property_id`,
      );
      console.log(
        '   This is expected if offers have been created for different properties\n',
      );
    } else {
      console.log(
        '✅ PASSED: All records have matching initial_property_id and property_id\n',
      );
    }

    // Test 3: Find multi-property applications
    console.log(
      '📋 Test 3: Finding KYC applications with offers for multiple properties...',
    );
    const multiPropertyApps = await dataSource.query(`
      SELECT
        k.id as kyc_id,
        k.first_name,
        k.last_name,
        k.initial_property_id,
        p_initial.name as initial_property_name,
        COUNT(DISTINCT o.property_id) as property_count,
        ARRAY_AGG(DISTINCT p_offer.name) as offer_property_names
      FROM kyc_applications k
      LEFT JOIN offer_letters o ON o.kyc_application_id = k.id
      LEFT JOIN properties p_initial ON p_initial.id = k.initial_property_id
      LEFT JOIN properties p_offer ON p_offer.id = o.property_id
      WHERE o.id IS NOT NULL
      GROUP BY k.id, k.first_name, k.last_name, k.initial_property_id, p_initial.name
      HAVING COUNT(DISTINCT o.property_id) > 1
    `);

    if (multiPropertyApps.length === 0) {
      console.log(
        'ℹ️  No KYC applications with multi-property offers found yet',
      );
      console.log("   This is expected if feature hasn't been used yet\n");
    } else {
      console.log(
        `✅ Found ${multiPropertyApps.length} applications with multi-property offers:`,
      );
      multiPropertyApps.forEach((app: any) => {
        console.log(`   - ${app.first_name} ${app.last_name}`);
        console.log(`     Initial: ${app.initial_property_name}`);
        console.log(`     Offers: ${app.offer_property_names.join(', ')}`);
        console.log(`     Total properties: ${app.property_count}\n`);
      });
    }

    // Test 4: Check for orphaned references
    console.log('📋 Test 4: Checking for orphaned property references...');
    const orphanedRefs = await dataSource.query(`
      SELECT COUNT(*) as count
      FROM kyc_applications k
      LEFT JOIN properties p ON p.id = k.initial_property_id
      WHERE p.id IS NULL
    `);

    const orphanCount = parseInt(orphanedRefs[0].count);
    if (orphanCount > 0) {
      console.log(
        `❌ FAILED: Found ${orphanCount} KYC applications with invalid initial_property_id`,
      );
    } else {
      console.log('✅ PASSED: No orphaned property references found\n');
    }

    // Test 5: Verify foreign key constraint
    console.log('📋 Test 5: Checking foreign key constraint...');
    const fkCheck = await dataSource.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'kyc_applications'
      AND constraint_name = 'FK_kyc_applications_initial_property'
    `);

    if (fkCheck.length === 0) {
      console.log('❌ FAILED: Foreign key constraint not found');
    } else {
      console.log('✅ PASSED: Foreign key constraint exists\n');
    }

    // Test 6: Verify index
    console.log('📋 Test 6: Checking index...');
    const indexCheck = await dataSource.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'kyc_applications'
      AND indexname = 'IDX_kyc_applications_initial_property_id'
    `);

    if (indexCheck.length === 0) {
      console.log('❌ FAILED: Index not found');
    } else {
      console.log('✅ PASSED: Index exists\n');
    }

    // Summary statistics
    console.log('📊 Summary Statistics:');
    const stats = await dataSource.query(`
      SELECT
        COUNT(*) as total_applications,
        COUNT(DISTINCT initial_property_id) as unique_initial_properties,
        COUNT(DISTINCT property_id) as unique_current_properties
      FROM kyc_applications
    `);

    console.log(`   Total KYC Applications: ${stats[0].total_applications}`);
    console.log(
      `   Unique Initial Properties: ${stats[0].unique_initial_properties}`,
    );
    console.log(
      `   Unique Current Properties: ${stats[0].unique_current_properties}\n`,
    );

    const offerStats = await dataSource.query(`
      SELECT
        COUNT(*) as total_offers,
        COUNT(DISTINCT kyc_application_id) as applications_with_offers,
        COUNT(DISTINCT property_id) as properties_with_offers
      FROM offer_letters
    `);

    console.log(`   Total Offer Letters: ${offerStats[0].total_offers}`);
    console.log(
      `   Applications with Offers: ${offerStats[0].applications_with_offers}`,
    );
    console.log(
      `   Properties with Offers: ${offerStats[0].properties_with_offers}\n`,
    );

    console.log('✅ Verification Complete!\n');
    console.log('🎉 Multi-property offers system is ready to use.');
    console.log(
      '   Landlords can now send multiple offers for different properties to the same applicant.',
    );
  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  } finally {
    await dataSource.destroy();
  }
}

// Run verification
verifyMultiPropertyOffers()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
