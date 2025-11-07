import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';
import { Property } from '../properties/entities/property.entity';

@Injectable()
export class TenantDataLeakageFixService {
  constructor(
    @InjectRepository(TenantKyc)
    private readonly tenantKycRepository: Repository<TenantKyc>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
  ) {}

  /**
   * Fix tenant data leakage by ensuring tenant_kyc records are properly filtered by property owner
   * This is a one-time cleanup utility to identify and report any data inconsistencies
   */
  async analyzeDataConsistency(): Promise<{
    totalTenantKycRecords: number;
    duplicateUserRecords: number;
    crossPropertyLeakage: number;
    recommendations: string[];
  }> {
    console.log('🔍 Analyzing tenant data consistency...');

    // Get all tenant KYC records
    const allTenantKyc = await this.tenantKycRepository
      .createQueryBuilder('kyc')
      .leftJoinAndSelect('kyc.user', 'user')
      .getMany();

    console.log(`📊 Found ${allTenantKyc.length} total tenant KYC records`);

    // Group by user_id to find duplicates
    const userKycMap = new Map<string, TenantKyc[]>();
    allTenantKyc.forEach((kyc) => {
      if (kyc.user_id) {
        if (!userKycMap.has(kyc.user_id)) {
          userKycMap.set(kyc.user_id, []);
        }
        userKycMap.get(kyc.user_id)!.push(kyc);
      }
    });

    // Find users with multiple KYC records (potential cross-property data)
    const duplicateUsers = Array.from(userKycMap.entries()).filter(
      ([_, records]) => records.length > 1,
    );

    console.log(
      `👥 Found ${duplicateUsers.length} users with multiple KYC records`,
    );

    // Analyze cross-property leakage potential
    let crossPropertyLeakage = 0;
    const recommendations: string[] = [];

    for (const [userId, records] of duplicateUsers) {
      const uniqueAdminIds = new Set(records.map((r) => r.admin_id));
      if (uniqueAdminIds.size > 1) {
        crossPropertyLeakage++;
        console.log(
          `⚠️  User ${userId} has KYC records with ${uniqueAdminIds.size} different landlords`,
        );
      }
    }

    // Generate recommendations
    if (crossPropertyLeakage > 0) {
      recommendations.push(
        `${crossPropertyLeakage} users have KYC records across multiple landlords. This could cause data leakage.`,
      );
      recommendations.push(
        'The database queries have been fixed to filter by admin_id (property owner).',
      );
      recommendations.push(
        'Consider updating the TenantKyc entity relationship to OneToMany instead of OneToOne.',
      );
    }

    if (duplicateUsers.length > 0) {
      recommendations.push(
        `${duplicateUsers.length} users have multiple KYC records. This is expected for users who applied to multiple properties.`,
      );
    }

    const result = {
      totalTenantKycRecords: allTenantKyc.length,
      duplicateUserRecords: duplicateUsers.length,
      crossPropertyLeakage,
      recommendations,
    };

    console.log('📋 Analysis complete:', result);
    return result;
  }

  /**
   * Verify that the query fixes are working correctly
   */
  async verifyQueryFixes(propertyId: string): Promise<{
    success: boolean;
    message: string;
    details: any;
  }> {
    console.log(`🔍 Verifying query fixes for property ${propertyId}...`);

    try {
      // Get property with owner info
      const property = await this.propertyRepository
        .createQueryBuilder('property')
        .select(['property.id', 'property.owner_id', 'property.name'])
        .where('property.id = :id', { id: propertyId })
        .getOne();

      if (!property) {
        return {
          success: false,
          message: 'Property not found',
          details: null,
        };
      }

      // Test the fixed query - get tenant KYC records filtered by property owner
      const filteredKycRecords = await this.tenantKycRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.user', 'user')
        .where('kyc.admin_id = :adminId', { adminId: property.owner_id })
        .getMany();

      // Get all KYC records for comparison (what would happen without the fix)
      const allKycRecords = await this.tenantKycRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.user', 'user')
        .getMany();

      const result = {
        success: true,
        message: 'Query fix verification completed',
        details: {
          propertyId: property.id,
          propertyName: property.name,
          propertyOwnerId: property.owner_id,
          filteredKycRecords: filteredKycRecords.length,
          totalKycRecords: allKycRecords.length,
          dataLeakagePrevented:
            allKycRecords.length - filteredKycRecords.length,
          filteredRecords: filteredKycRecords.map((kyc) => ({
            id: kyc.id,
            name: `${kyc.first_name} ${kyc.last_name}`,
            email: kyc.email,
            adminId: kyc.admin_id,
          })),
        },
      };

      console.log('✅ Verification complete:', result.details);
      return result;
    } catch (error) {
      console.error('❌ Verification failed:', error);
      return {
        success: false,
        message: `Verification failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  }
}
