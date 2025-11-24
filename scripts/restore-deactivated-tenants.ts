import { DataSource } from 'typeorm';
import { Rent } from '../src/rents/entities/rent.entity';
import { PropertyTenant } from '../src/properties/entities/property-tenants.entity';
import { Property } from '../src/properties/entities/property.entity';
import { PropertyHistory } from '../src/property-history/entities/property-history.entity';
import {
  RentStatusEnum,
  RentPaymentStatusEnum,
} from '../src/rents/dto/create-rent.dto';
import {
  TenantStatusEnum,
  PropertyStatusEnum,
} from '../src/properties/dto/create-property.dto';

/**
 * Script to restore tenant assignments that were incorrectly deactivated
 * by the cleanupExistingTenantAssignments method
 *
 * This script:
 * 1. Finds property history records with move_out_reason = 'other' and
 *    owner_comment = 'Tenant reassigned to another property via KYC system'
 * 2. Reactivates the corresponding rent records
 * 3. Reactivates the property-tenant relationships
 * 4. Updates property status back to OCCUPIED
 * 5. Removes the incorrect move-out history records
 */

interface RestorationResult {
  success: boolean;
  restoredRents: number;
  restoredPropertyTenants: number;
  restoredProperties: number;
  removedHistoryRecords: number;
  errors: string[];
}

export async function restoreDeactivatedTenants(
  dataSource: DataSource,
): Promise<RestorationResult> {
  const result: RestorationResult = {
    success: false,
    restoredRents: 0,
    restoredPropertyTenants: 0,
    restoredProperties: 0,
    removedHistoryRecords: 0,
    errors: [],
  };

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    console.log('Starting restoration of deactivated tenant assignments...\n');

    // Step 1: Find all incorrect move-out history records
    const incorrectMoveOuts = await queryRunner.manager
      .createQueryBuilder(PropertyHistory, 'ph')
      .where("ph.move_out_reason = 'other'")
      .andWhere(
        "ph.owner_comment = 'Tenant reassigned to another property via KYC system'",
      )
      .andWhere('ph.move_out_date IS NOT NULL')
      .orderBy('ph.created_at', 'DESC')
      .getMany();

    console.log(
      `Found ${incorrectMoveOuts.length} incorrect move-out records to restore\n`,
    );

    if (incorrectMoveOuts.length === 0) {
      console.log('No tenant assignments need restoration.');
      await queryRunner.commitTransaction();
      result.success = true;
      return result;
    }

    // Step 2: Process each incorrect move-out
    for (const moveOut of incorrectMoveOuts) {
      console.log(
        `\nProcessing tenant ${moveOut.tenant_id} in property ${moveOut.property_id}:`,
      );

      try {
        // Find the deactivated rent record
        const deactivatedRent = await queryRunner.manager.findOne(Rent, {
          where: {
            tenant_id: moveOut.tenant_id,
            property_id: moveOut.property_id,
            rent_status: RentStatusEnum.INACTIVE,
          },
          order: { updated_at: 'DESC' },
        });

        if (deactivatedRent) {
          // Check if there's a more recent ACTIVE rent for this tenant in a different property
          const activeRentElsewhere = await queryRunner.manager.findOne(Rent, {
            where: {
              tenant_id: moveOut.tenant_id,
              rent_status: RentStatusEnum.ACTIVE,
            },
          });

          // Only restore if the tenant should still be active in this property
          // (i.e., the lease hasn't actually ended)
          const now = new Date();
          const leaseStillValid =
            deactivatedRent.lease_end_date &&
            new Date(deactivatedRent.lease_end_date) > now;

          if (leaseStillValid) {
            // Reactivate the rent record
            await queryRunner.manager.update(Rent, deactivatedRent.id, {
              rent_status: RentStatusEnum.ACTIVE,
              payment_status: RentPaymentStatusEnum.PENDING, // Reset to pending
            });

            console.log(`  ✅ Reactivated rent record ${deactivatedRent.id}`);
            result.restoredRents++;

            // Reactivate property-tenant relationship
            const deactivatedPT = await queryRunner.manager.findOne(
              PropertyTenant,
              {
                where: {
                  tenant_id: moveOut.tenant_id,
                  property_id: moveOut.property_id,
                  status: TenantStatusEnum.INACTIVE,
                },
                order: { updated_at: 'DESC' },
              },
            );

            if (deactivatedPT) {
              await queryRunner.manager.update(
                PropertyTenant,
                deactivatedPT.id,
                {
                  status: TenantStatusEnum.ACTIVE,
                },
              );

              console.log(
                `  ✅ Reactivated property-tenant relationship ${deactivatedPT.id}`,
              );
              result.restoredPropertyTenants++;
            }

            // Update property status back to OCCUPIED
            const property = await queryRunner.manager.findOne(Property, {
              where: { id: moveOut.property_id },
            });

            if (
              property &&
              property.property_status === PropertyStatusEnum.VACANT
            ) {
              await queryRunner.manager.update(Property, moveOut.property_id, {
                property_status: PropertyStatusEnum.OCCUPIED,
              });

              console.log(
                `  ✅ Updated property ${moveOut.property_id} status to OCCUPIED`,
              );
              result.restoredProperties++;
            }

            // Remove the incorrect move-out history record
            await queryRunner.manager.remove(moveOut);
            console.log(
              `  ✅ Removed incorrect move-out history record ${moveOut.id}`,
            );
            result.removedHistoryRecords++;
          } else {
            console.log(
              `  ⏭️  Skipped - lease has expired (end date: ${deactivatedRent.lease_end_date})`,
            );
          }
        } else {
          console.log(`  ⚠️  No deactivated rent record found`);
        }
      } catch (error) {
        const errorMsg = `Error processing tenant ${moveOut.tenant_id} in property ${moveOut.property_id}: ${error.message}`;
        console.error(`  ❌ ${errorMsg}`);
        result.errors.push(errorMsg);
        // Continue with other records instead of failing completely
      }
    }

    await queryRunner.commitTransaction();
    result.success = true;

    console.log('\n' + '='.repeat(60));
    console.log('RESTORATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`✅ Restored rent records: ${result.restoredRents}`);
    console.log(
      `✅ Restored property-tenant relationships: ${result.restoredPropertyTenants}`,
    );
    console.log(`✅ Restored property statuses: ${result.restoredProperties}`);
    console.log(
      `✅ Removed incorrect history records: ${result.removedHistoryRecords}`,
    );
    if (result.errors.length > 0) {
      console.log(`⚠️  Errors encountered: ${result.errors.length}`);
      result.errors.forEach((err) => console.log(`   - ${err}`));
    }
    console.log('='.repeat(60) + '\n');

    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error('Fatal error during restoration:', error);
    result.errors.push(`Fatal error: ${error.message}`);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

// If running directly
if (require.main === module) {
  (async () => {
    // Import your data source configuration
    const { AppDataSource } = await import('../ormconfig');

    try {
      await AppDataSource.initialize();
      console.log('Database connection established\n');

      const result = await restoreDeactivatedTenants(AppDataSource);

      if (result.success) {
        console.log('✅ Restoration completed successfully!');
        process.exit(0);
      } else {
        console.error('❌ Restoration completed with errors');
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    } finally {
      await AppDataSource.destroy();
    }
  })();
}
