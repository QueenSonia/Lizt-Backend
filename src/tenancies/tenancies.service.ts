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
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { Users } from 'src/users/entities/user.entity';
import { UtilService } from 'src/utils/utility-service';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
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
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
    private readonly whatsappBotService: WhatsappBotService,
    private readonly utilService: UtilService,
    private dataSource: DataSource,
  ) { }

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

    const savedTenant =
      await this.propertyTenantRepository.save(newPropertyTenant);

    try {
      console.log('Attempting to send tenant attachment notification...');
      const tenantUser = await this.usersRepository.findOne({
        where: { accounts: { id: tenantId } },
      });
      const property = await this.propertyRepository.findOne({
        where: { id: property_id },
        relations: ['owner', 'owner.user'],
      });

      if (tenantUser && property && property.owner) {
        await this.whatsappBotService.sendTenantAttachmentNotification({
          phone_number: this.utilService.normalizePhoneNumber(
            tenantUser.phone_number,
          ),
          tenant_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          landlord_name: property.owner.user.first_name,
          apartment_name: property.name,
        });
        console.log(
          'Successfully sent tenant attachment notification to:',
          tenantUser.phone_number,
        );
      } else {
        console.log(
          'Could not send notification. Missing tenant, property, or owner information.',
        );
      }
    } catch (error) {
      console.error('Error sending tenant attachment notification:', error);
    }

    return savedTenant;
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

      // 3. Validate and parse dates
      const startDate = new Date(renewTenancyDto.startDate);
      const endDate = new Date(renewTenancyDto.endDate);

      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }

      // 4. Update the rent record with new tenancy details
      // Note: In the new rent-based system, renewal updates rent terms
      // The lease_agreement_end_date is optional and for reference only
      activeRent.rent_start_date = startDate;
      activeRent.lease_agreement_end_date = endDate; // Optional reference
      activeRent.rental_price = renewTenancyDto.rentAmount;
      activeRent.payment_frequency = renewTenancyDto.paymentFrequency;
      activeRent.updated_at = new Date();

      // Calculate next rent due date based on new terms
      // Logic: Start Date + Frequency - 1 Day
      const nextRentDate = new Date(startDate);
      const dueDay = startDate.getDate();
      let monthsToAdd = 0;

      switch (renewTenancyDto.paymentFrequency.toLowerCase()) {
        case 'monthly':
          monthsToAdd = 1;
          break;
        case 'quarterly':
          monthsToAdd = 3;
          break;
        case 'bi-annually':
          monthsToAdd = 6;
          break;
        case 'annually':
          monthsToAdd = 12;
          break;
        default:
          monthsToAdd = 1; // Default to monthly
      }

      nextRentDate.setMonth(nextRentDate.getMonth() + monthsToAdd);

      // Handle month overflow (e.g. Jan 31 + 1 month -> Feb 28/29)
      const targetMonth = (startDate.getMonth() + monthsToAdd) % 12;
      if (nextRentDate.getMonth() !== targetMonth) {
        nextRentDate.setDate(0); // Set to last day of previous month
      }

      // Subtract 1 day to get the due date (day before next cycle starts)
      nextRentDate.setDate(nextRentDate.getDate() - 1);

      activeRent.expiry_date = nextRentDate;

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
