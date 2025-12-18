import { DataSource } from 'typeorm';
import { Property } from '../src/properties/entities/property.entity';
import { PropertyTenant } from '../src/properties/entities/property-tenants.entity';
import { PropertyHistory } from '../src/property-history/entities/property-history.entity';
import { Rent } from '../src/rents/entities/rent.entity';
import { KYCApplication } from '../src/kyc-links/entities/kyc-application.entity';
import { TenantKyc } from '../src/tenant-kyc/entities/tenant-kyc.entity';
import { Users } from '../src/users/entities/user.entity';
import { Account } from '../src/users/entities/account.entity';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Properties to delete
const PROPERTIES_TO_DELETE = [
  'Two Bed Apartment (First Floor Right Wing) at Vier Apartments',
  'Studio Apartment at Babatope Bejide',
  'One Bed Apartment (First Floor Right Wing) at Vier Apartments',
  'The Office',
  'Penthouse Miniflat at 17 Ayinde Akinmade Street',
  'One Bed Apartment (Apartment D3) at 21 Ibiyinka Salvador Street',
  'Longonot Heights',
  'Two Bed Apartment at 19 Ayinde Akinmade Street',
  'Three Bed Ground floor Apartment at Oyibo Adjarho',
  'BQ Miniflat at Ibiyinka Salvador',
  'First floor Two-Bed (Right Side) at 17 Ayinde Akinmade Street',
  'Miniflat at 19 Ayinde Akinmade Street',
  'Groundfloor Miniflat (Right Side) at 17 Ayinde Akinmade Street',
];

// Database configuration
const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PROD_DB_HOST,
  port: parseInt(process.env.PROD_PORT || '5432'),
  username: process.env.PROD_DB_USERNAME,
  password: process.env.PROD_DB_PASSWORD,
  database: process.env.PROD_DB_NAME,
  ssl: process.env.PROD_DB_SSL === 'true',
  entities: [
    Property,
    PropertyTenant,
    PropertyHistory,
    Rent,
    KYCApplication,
    TenantKyc,
    Users,
    Account,
  ],
  synchronize: false,
  logging: true,
});

async function forceDeleteProperty(
  propertyId: string,
  propertyName: string,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    console.log(
      `🗑️  Starting force delete for property: ${propertyName} (ID: ${propertyId})`,
    );

    // Delete all associated records in order (respecting foreign key constraints)

    // 1. Delete auto service requests (through property_tenant_id)
    const propertyTenants = await queryRunner.manager.find(PropertyTenant, {
      where: { property_id: propertyId },
      select: ['id'],
    });

    const propertyTenantIds = propertyTenants.map((pt) => pt.id);

    if (propertyTenantIds.length > 0) {
      const autoServiceRequestsDeleted = await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from('auto_service_requests')
        .where('property_tenant_id IN (:...ids)', { ids: propertyTenantIds })
        .execute();
      console.log(
        `   ✅ Deleted ${autoServiceRequestsDeleted.affected} auto service requests`,
      );
    }

    // 2. Delete scheduled move-outs
    const scheduledMoveOutsDeleted = await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('scheduled_move_outs')
      .where('property_id = :propertyId', { propertyId })
      .execute();
    console.log(
      `   ✅ Deleted ${scheduledMoveOutsDeleted.affected} scheduled move-outs`,
    );

    // 3. Delete notifications
    const notificationsDeleted = await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('notification')
      .where('property_id = :propertyId', { propertyId })
      .execute();
    console.log(`   ✅ Deleted ${notificationsDeleted.affected} notifications`);

    // 4. Delete notice agreements
    const noticeAgreementsDeleted = await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('notice_agreement')
      .where('property_id = :propertyId', { propertyId })
      .execute();
    console.log(
      `   ✅ Deleted ${noticeAgreementsDeleted.affected} notice agreements`,
    );

    // 5. Delete rent increases
    const rentIncreasesDeleted = await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('rent_increases')
      .where('property_id = :propertyId', { propertyId })
      .execute();
    console.log(
      `   ✅ Deleted ${rentIncreasesDeleted.affected} rent increases`,
    );

    // 6. Delete property history
    const propertyHistoryDeleted = await queryRunner.manager.delete(
      PropertyHistory,
      {
        property_id: propertyId,
      },
    );
    console.log(
      `   ✅ Deleted ${propertyHistoryDeleted.affected} property history records`,
    );

    // 7. Delete service requests
    const serviceRequestsDeleted = await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('service_requests')
      .where('property_id = :propertyId', { propertyId })
      .execute();
    console.log(
      `   ✅ Deleted ${serviceRequestsDeleted.affected} service requests`,
    );

    // 8. Get tenant IDs from rents before deleting them (for KYC cleanup)
    const rentsWithTenants = await queryRunner.manager
      .createQueryBuilder()
      .select('tenant_id')
      .from('rents', 'rent')
      .where('property_id = :propertyId', { propertyId })
      .getRawMany();

    const tenantIds = rentsWithTenants.map((r) => r.tenant_id).filter(Boolean);

    // 9. Delete rents
    const rentsDeleted = await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('rents')
      .where('property_id = :propertyId', { propertyId })
      .execute();
    console.log(`   ✅ Deleted ${rentsDeleted.affected} rent records`);

    // 10. Delete KYC applications
    const kycApplicationsDeleted = await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('kyc_applications')
      .where('property_id = :propertyId', { propertyId })
      .execute();
    console.log(
      `   ✅ Deleted ${kycApplicationsDeleted.affected} KYC applications`,
    );

    // 11. Delete property tenants
    const propertyTenantsDeleted = await queryRunner.manager.delete(
      PropertyTenant,
      {
        property_id: propertyId,
      },
    );
    console.log(
      `   ✅ Deleted ${propertyTenantsDeleted.affected} property-tenant relationships`,
    );

    // 12. Remove property from property groups
    const propertyGroups = await queryRunner.manager
      .createQueryBuilder()
      .select(['id', 'property_ids'])
      .from('property_groups', 'pg')
      .where('property_ids @> :propertyId', { propertyId: `["${propertyId}"]` })
      .getRawMany();

    for (const group of propertyGroups) {
      const updatedPropertyIds = group.property_ids.filter(
        (id: string) => id !== propertyId,
      );
      await queryRunner.manager
        .createQueryBuilder()
        .update('property_groups')
        .set({ property_ids: updatedPropertyIds })
        .where('id = :id', { id: group.id })
        .execute();
    }
    console.log(
      `   ✅ Removed property from ${propertyGroups.length} property groups`,
    );

    // 13. Clean up orphaned tenant accounts and KYC data
    if (tenantIds.length > 0) {
      console.log(`   🧹 Cleaning up ${tenantIds.length} tenant accounts...`);

      for (const tenantId of tenantIds) {
        // Check if tenant has other active properties
        const otherProperties = await queryRunner.manager
          .createQueryBuilder()
          .select('COUNT(*)')
          .from('rents', 'rent')
          .where('tenant_id = :tenantId', { tenantId })
          .andWhere('rent_status = :status', { status: 'active' })
          .getRawOne();

        if (parseInt(otherProperties.count) === 0) {
          // Tenant has no other active properties, safe to delete

          // Delete tenant KYC records
          const tenantKycDeleted = await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from('tenant_kycs')
            .where('tenant_id = :tenantId', { tenantId })
            .execute();
          console.log(
            `     ✅ Deleted ${tenantKycDeleted.affected} tenant KYC records for tenant ${tenantId}`,
          );

          // Delete tenant account
          const accountDeleted = await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from('accounts')
            .where('id = :tenantId', { tenantId })
            .execute();
          console.log(
            `     ✅ Deleted ${accountDeleted.affected} tenant account for ${tenantId}`,
          );

          // Get user ID from account to delete user record
          const account = await queryRunner.manager
            .createQueryBuilder()
            .select('userId')
            .from('accounts', 'account')
            .where('id = :tenantId', { tenantId })
            .getRawOne();

          if (account?.userId) {
            const userDeleted = await queryRunner.manager
              .createQueryBuilder()
              .delete()
              .from('users')
              .where('id = :userId', { userId: account.userId })
              .execute();
            console.log(
              `     ✅ Deleted ${userDeleted.affected} user record for ${account.userId}`,
            );
          }
        } else {
          console.log(
            `     ⚠️  Tenant ${tenantId} has other active properties, keeping account`,
          );
        }
      }
    }

    // 14. Finally, delete the property itself (hard delete)
    const propertyDeleted = await queryRunner.manager.delete(Property, {
      id: propertyId,
    });
    console.log(`   ✅ Deleted ${propertyDeleted.affected} property record`);

    await queryRunner.commitTransaction();

    console.log(
      `✅ Successfully force deleted property: ${propertyName} (ID: ${propertyId})`,
    );
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error(`❌ Force delete failed for ${propertyName}:`, error);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function main() {
  try {
    console.log('🚀 Connecting to database...');
    await dataSource.initialize();
    console.log('✅ Database connected successfully');

    console.log(
      `\n🔍 Searching for ${PROPERTIES_TO_DELETE.length} properties to delete...\n`,
    );

    const foundProperties: { id: string; name: string }[] = [];
    const notFoundProperties: string[] = [];

    // Find all properties by name
    for (const propertyName of PROPERTIES_TO_DELETE) {
      const property = await dataSource.manager.findOne(Property, {
        where: { name: propertyName },
        select: ['id', 'name'],
      });

      if (property) {
        foundProperties.push({ id: property.id, name: property.name });
        console.log(`✅ Found: ${property.name} (ID: ${property.id})`);
      } else {
        notFoundProperties.push(propertyName);
        console.log(`❌ Not found: ${propertyName}`);
      }
    }

    if (notFoundProperties.length > 0) {
      console.log(
        `\n⚠️  ${notFoundProperties.length} properties were not found:`,
      );
      notFoundProperties.forEach((name) => console.log(`   - ${name}`));
    }

    if (foundProperties.length === 0) {
      console.log('\n❌ No properties found to delete. Exiting...');
      return;
    }

    console.log(
      `\n🗑️  Starting deletion of ${foundProperties.length} properties...\n`,
    );

    // Delete each property
    for (const property of foundProperties) {
      try {
        await forceDeleteProperty(property.id, property.name);
      } catch (error) {
        console.error(`❌ Failed to delete ${property.name}:`, error.message);
        // Continue with other properties
      }
    }

    console.log(`\n🎉 Deletion process completed!`);
    console.log(
      `   ✅ Successfully deleted: ${foundProperties.length} properties`,
    );
    if (notFoundProperties.length > 0) {
      console.log(`   ⚠️  Not found: ${notFoundProperties.length} properties`);
    }
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run the script
main().catch(console.error);
