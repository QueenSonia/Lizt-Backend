import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { RenewTenancyDto } from './dto/renew-tenancy.dto';
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
import {
  KYCApplication,
} from '../kyc-links/entities/kyc-application.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';

@Injectable()
export class TenanciesService {
  constructor(
    @InjectRepository(PropertyTenant)
    private propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Rent)
    private rentRepository: Repository<Rent>,
    @InjectRepository(Property)
    private propertyRepository: Repository<Property>,
    @InjectRepository(PropertyHistory)
    private propertyHistoryRepository: Repository<PropertyHistory>,
    private dataSource: DataSource,
  ) {}

  async createTenancyFromKYC(
    kycApplication: KYCApplication,
    tenantId: string,
  ): Promise<PropertyTenant> {
    const { property_id } = kycApplication;

    // Create a new PropertyTenant record
    const newPropertyTenant = this.propertyTenantRepository.create({
      property_id,
      tenant_id: tenantId,
      status: TenantStatusEnum.ACTIVE,
    });

    return this.propertyTenantRepository.save(newPropertyTenant);
  }

  async renewTenancy(
    propertyTenantId: string,
    renewTenancyDto: RenewTenancyDto,
  ) {
    // Use transaction to ensure all updates succeed or fail together
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Find the PropertyTenant relationship
      const propertyTenant = await this.propertyTenantRepository.findOne({
        where: { id: propertyTenantId },
        relations: ['property', 'tenant'],
      });

      if (!propertyTenant) {
        throw new NotFoundException(
          `Property tenant relationship with ID ${propertyTenantId} not found`,
        );
      }

      // 2. Find the active rent record for this property and tenant
      const activeRent = await this.rentRepository.findOne({
        where: {
          property_id: propertyTenant.property_id,
          tenant_id: propertyTenant.tenant_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (!activeRent) {
        throw new NotFoundException(
          'No active rent record found for this tenancy',
        );
      }

      // 3. Validate dates
      const startDate = new Date(renewTenancyDto.startDate);
      const endDate = new Date(renewTenancyDto.endDate);

      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }

      // 4. Update the rent record with new tenancy details
      activeRent.lease_start_date = startDate;
      activeRent.lease_end_date = endDate;
      activeRent.expiry_date = endDate;
      activeRent.rental_price = renewTenancyDto.rentAmount;
      activeRent.payment_frequency = renewTenancyDto.paymentFrequency;
      activeRent.updated_at = new Date();

      await queryRunner.manager.save(Rent, activeRent);

      // 5. Create property history entry for the renewal
      const historyEntry = this.propertyHistoryRepository.create({
        property_id: propertyTenant.property_id,
        tenant_id: propertyTenant.tenant_id,
        move_in_date: startDate,
        monthly_rent: renewTenancyDto.rentAmount,
        owner_comment: `Tenancy renewed. New rent: ₦${renewTenancyDto.rentAmount.toLocaleString()}, Period: ${renewTenancyDto.startDate} to ${renewTenancyDto.endDate}, Payment: ${renewTenancyDto.paymentFrequency}. Previous rent: ₦${activeRent.rental_price?.toLocaleString() || 'N/A'}`,
      });

      await queryRunner.manager.save(PropertyHistory, historyEntry);

      // 6. Commit the transaction
      await queryRunner.commitTransaction();

      // 7. Return the updated data
      return {
        success: true,
        message: 'Tenancy renewed successfully',
        data: {
          propertyTenant,
          rent: activeRent,
        },
      };
    } catch (error) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }
}
