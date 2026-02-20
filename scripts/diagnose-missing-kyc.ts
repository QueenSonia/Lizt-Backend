import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

interface DiagnosticResult {
  applications: any[];
  offerLetters: any[];
  properties: any[];
  tenantAccounts: any[];
}

async function diagnoseMissingKYC(
  phoneOrEmail: string,
): Promise<DiagnosticResult> {
  // Create database connection
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await dataSource.initialize();

  try {
    console.log('\n🔍 Diagnosing KYC Application Issue...\n');
    console.log(`Searching for: ${phoneOrEmail}\n`);

    // 1. Find all KYC applications
    console.log('📋 Step 1: Finding all KYC applications...');
    const applications = await dataSource.query(
      `
      SELECT 
        ka.id,
        ka.property_id,
        ka.status,
        ka.first_name,
        ka.last_name,
        ka.phone_number,
        ka.email,
        ka.tenant_id,
        ka.deleted_at,
        ka.created_at,
        ka.updated_at,
        p.name as property_name,
        p.owner_id,
        p.property_status
      FROM kyc_applications ka
      LEFT JOIN properties p ON ka.property_id = p.id
      WHERE ka.phone_number = $1 
         OR ka.email = $1
         OR ka.phone_number LIKE $2
      ORDER BY ka.created_at DESC
    `,
      [phoneOrEmail, `%${phoneOrEmail.slice(-4)}%`],
    );

    console.log(`Found ${applications.length} application(s):\n`);
    applications.forEach((app, index) => {
      console.log(`  Application #${index + 1}:`);
      console.log(`    ID: ${app.id}`);
      console.log(`    Status: ${app.status}`);
      console.log(`    Name: ${app.first_name} ${app.last_name}`);
      console.log(`    Property: ${app.property_name} (${app.property_id})`);
      console.log(`    Property Status: ${app.property_status}`);
      console.log(`    Tenant ID: ${app.tenant_id || 'NULL'}`);
      console.log(`    Deleted: ${app.deleted_at ? 'YES' : 'NO'}`);
      console.log(`    Created: ${app.created_at}`);
      console.log(`    Updated: ${app.updated_at}`);
      console.log('');
    });

    // 2. Find all offer letters
    console.log('📨 Step 2: Finding all offer letters...');
    const offerLetters = await dataSource.query(
      `
      SELECT 
        ol.id,
        ol.kyc_application_id,
        ol.property_id,
        ol.status,
        ol.rent_amount,
        ol.total_amount,
        ol.amount_paid,
        ol.outstanding_balance,
        ol.payment_status,
        ol.accepted_at,
        ol.created_at,
        p.name as property_name,
        ka.status as application_status
      FROM offer_letters ol
      JOIN kyc_applications ka ON ol.kyc_application_id = ka.id
      JOIN properties p ON ol.property_id = p.id
      WHERE ka.phone_number = $1 
         OR ka.email = $1
         OR ka.phone_number LIKE $2
      ORDER BY ol.created_at DESC
    `,
      [phoneOrEmail, `%${phoneOrEmail.slice(-4)}%`],
    );

    console.log(`Found ${offerLetters.length} offer letter(s):\n`);
    offerLetters.forEach((offer, index) => {
      console.log(`  Offer #${index + 1}:`);
      console.log(`    ID: ${offer.id}`);
      console.log(`    KYC Application ID: ${offer.kyc_application_id}`);
      console.log(
        `    Property: ${offer.property_name} (${offer.property_id})`,
      );
      console.log(`    Offer Status: ${offer.status}`);
      console.log(`    Application Status: ${offer.application_status}`);
      console.log(
        `    Amount Paid: ₦${Number(offer.amount_paid || 0).toLocaleString()}`,
      );
      console.log(
        `    Total Amount: ₦${Number(offer.total_amount || 0).toLocaleString()}`,
      );
      console.log(
        `    Outstanding: ₦${Number(offer.outstanding_balance || 0).toLocaleString()}`,
      );
      console.log(`    Payment Status: ${offer.payment_status || 'N/A'}`);
      console.log(`    Accepted At: ${offer.accepted_at || 'Not accepted'}`);
      console.log(`    Created: ${offer.created_at}`);
      console.log('');
    });

    // 3. Find properties
    console.log('🏠 Step 3: Finding related properties...');
    const properties = await dataSource.query(
      `
      SELECT DISTINCT
        p.id,
        p.name,
        p.property_status,
        p.owner_id,
        u.email as owner_email,
        u.first_name as owner_first_name,
        u.last_name as owner_last_name
      FROM properties p
      JOIN accounts a ON p.owner_id = a.id
      JOIN users u ON a.user_id = u.id
      WHERE p.id IN (
        SELECT DISTINCT property_id 
        FROM kyc_applications 
        WHERE phone_number = $1 OR email = $1 OR phone_number LIKE $2
      )
    `,
      [phoneOrEmail, `%${phoneOrEmail.slice(-4)}%`],
    );

    console.log(`Found ${properties.length} property/properties:\n`);
    properties.forEach((prop, index) => {
      console.log(`  Property #${index + 1}:`);
      console.log(`    ID: ${prop.id}`);
      console.log(`    Name: ${prop.name}`);
      console.log(`    Status: ${prop.property_status}`);
      console.log(
        `    Owner: ${prop.owner_first_name} ${prop.owner_last_name} (${prop.owner_email})`,
      );
      console.log('');
    });

    // 4. Find tenant accounts
    console.log('👤 Step 4: Finding tenant accounts...');
    const tenantAccounts = await dataSource.query(
      `
      SELECT 
        a.id as account_id,
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.email,
        u.phone_number,
        a.role,
        a.created_at
      FROM accounts a
      JOIN users u ON a.user_id = u.id
      WHERE u.phone_number = $1 
         OR u.email = $1
         OR u.phone_number LIKE $2
      ORDER BY a.created_at DESC
    `,
      [phoneOrEmail, `%${phoneOrEmail.slice(-4)}%`],
    );

    console.log(`Found ${tenantAccounts.length} account(s):\n`);
    tenantAccounts.forEach((account, index) => {
      console.log(`  Account #${index + 1}:`);
      console.log(`    Account ID: ${account.account_id}`);
      console.log(`    User ID: ${account.user_id}`);
      console.log(`    Name: ${account.first_name} ${account.last_name}`);
      console.log(`    Email: ${account.email}`);
      console.log(`    Phone: ${account.phone_number}`);
      console.log(`    Role: ${account.role}`);
      console.log(`    Created: ${account.created_at}`);
      console.log('');
    });

    // 5. Analysis
    console.log('📊 Analysis:\n');

    const approvedApps = applications.filter((a) => a.status === 'approved');
    const pendingApps = applications.filter((a) => a.status === 'pending');
    const rejectedApps = applications.filter((a) => a.status === 'rejected');
    const deletedApps = applications.filter((a) => a.deleted_at !== null);

    console.log(`  Total Applications: ${applications.length}`);
    console.log(`  - Approved: ${approvedApps.length}`);
    console.log(`  - Pending: ${pendingApps.length}`);
    console.log(`  - Rejected: ${rejectedApps.length}`);
    console.log(`  - Soft Deleted: ${deletedApps.length}`);
    console.log('');

    const paidOffers = offerLetters.filter(
      (o) => Number(o.amount_paid) >= Number(o.total_amount),
    );
    const unpaidOffers = offerLetters.filter(
      (o) => Number(o.amount_paid) < Number(o.total_amount),
    );

    console.log(`  Total Offers: ${offerLetters.length}`);
    console.log(`  - Fully Paid: ${paidOffers.length}`);
    console.log(`  - Unpaid/Partial: ${unpaidOffers.length}`);
    console.log('');

    // 6. Recommendations
    console.log('💡 Recommendations:\n');

    if (pendingApps.length === 0 && unpaidOffers.length > 0) {
      console.log(
        '  ⚠️  ISSUE FOUND: There are unpaid offers but no pending applications!',
      );
      console.log(
        '  This means the unpaid application(s) were incorrectly marked as approved or rejected.',
      );
      console.log('');

      unpaidOffers.forEach((offer) => {
        const app = applications.find((a) => a.id === offer.kyc_application_id);
        if (app && app.status !== 'pending') {
          console.log(`  🔧 Fix needed for Application ${app.id}:`);
          console.log(`     Current Status: ${app.status}`);
          console.log(`     Should be: pending`);
          console.log(`     Property: ${app.property_name}`);
          console.log(`     SQL Fix:`);
          console.log(`     UPDATE kyc_applications`);
          console.log(`     SET status = 'pending', tenant_id = NULL`);
          console.log(`     WHERE id = '${app.id}';`);
          console.log('');
        }
      });
    }

    if (deletedApps.length > 0) {
      console.log('  ⚠️  ISSUE FOUND: Some applications are soft-deleted!');
      deletedApps.forEach((app) => {
        console.log(`     - Application ${app.id} (${app.property_name})`);
      });
      console.log('');
    }

    if (applications.length === 0) {
      console.log('  ⚠️  NO APPLICATIONS FOUND!');
      console.log('  The tenant might have used a different phone/email.');
      console.log('');
    }

    return {
      applications,
      offerLetters,
      properties,
      tenantAccounts,
    };
  } finally {
    await dataSource.destroy();
  }
}

// Run the diagnostic
const phoneOrEmail = process.argv[2];

if (!phoneOrEmail) {
  console.error('Usage: npm run diagnose-kyc <phone_or_email>');
  console.error('Example: npm run diagnose-kyc +2348012345678');
  console.error('Example: npm run diagnose-kyc tenant@example.com');
  process.exit(1);
}

diagnoseMissingKYC(phoneOrEmail)
  .then(() => {
    console.log('✅ Diagnostic complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Diagnostic failed:', error);
    process.exit(1);
  });
