import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { RenewTenancyDto } from './dto/renew-tenancy.dto';
import {
  RentStatusEnum,
  RentPaymentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { RentIncrease } from 'src/rents/entities/rent-increase.entity';
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
    @InjectRepository(RentIncrease)
    private rentIncreaseRepository: Repository<RentIncrease>,
    private readonly whatsappBotService: WhatsappBotService,
    private readonly utilService: UtilService,
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
    userId: string,
  ) {
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

      // 2. Verify ownership
      if (propertyTenant.property.owner_id !== userId) {
        throw new HttpException(
          'You do not have permission to renew this tenancy',
          HttpStatus.FORBIDDEN,
        );
      }

      // 3. Find the active rent record for this property and tenant
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

      if (!activeRent.expiry_date) {
        throw new BadRequestException(
          'Active rent has no expiry date set. Cannot calculate renewal start date.',
        );
      }

      // 4. Capture previous rent for history and rent increase tracking
      const previousRentalPrice = activeRent.rental_price;

      // 5. Calculate new start date (day after current rent expires)
      const newStartDate = new Date(activeRent.expiry_date);
      newStartDate.setDate(newStartDate.getDate() + 1);

      // 6. Calculate new expiry date: start + frequency - 1 day
      const newExpiryDate = new Date(newStartDate);
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
          monthsToAdd = 1;
      }

      newExpiryDate.setMonth(newExpiryDate.getMonth() + monthsToAdd);

      // Handle month overflow (e.g. Jan 31 + 1 month -> Feb 28/29)
      const targetMonth = (newStartDate.getMonth() + monthsToAdd) % 12;
      if (newExpiryDate.getMonth() !== targetMonth) {
        newExpiryDate.setDate(0);
      }

      // Subtract 1 day (day before next cycle starts)
      newExpiryDate.setDate(newExpiryDate.getDate() - 1);

      // 7. Mark old rent as INACTIVE
      activeRent.rent_status = RentStatusEnum.INACTIVE;
      activeRent.updated_at = new Date();
      await queryRunner.manager.save(Rent, activeRent);

      // 8. Create new rent record
      const newRent = await queryRunner.manager.save(Rent, {
        property_id: propertyTenant.property_id,
        tenant_id: propertyTenant.tenant_id,
        rent_start_date: newStartDate,
        lease_agreement_end_date: newExpiryDate,
        expiry_date: newExpiryDate,
        rental_price: renewTenancyDto.rentAmount,
        amount_paid: renewTenancyDto.rentAmount,
        security_deposit: activeRent.security_deposit,
        service_charge: activeRent.service_charge,
        payment_frequency: renewTenancyDto.paymentFrequency,
        payment_status: RentPaymentStatusEnum.PENDING,
        rent_status: RentStatusEnum.ACTIVE,
      });

      // 9. Create RentIncrease record if amount changed
      if (renewTenancyDto.rentAmount !== previousRentalPrice) {
        await queryRunner.manager.save(RentIncrease, {
          property_id: propertyTenant.property_id,
          initial_rent: previousRentalPrice,
          current_rent: renewTenancyDto.rentAmount,
          rent_increase_date: newStartDate,
          reason: 'Tenancy renewal',
        });
      }

      // 10. Create property history entry
      const startDateStr = newStartDate.toISOString().split('T')[0];
      const endDateStr = newExpiryDate.toISOString().split('T')[0];

      const historyEntry = this.propertyHistoryRepository.create({
        property_id: propertyTenant.property_id,
        tenant_id: propertyTenant.tenant_id,
        move_in_date: newStartDate,
        monthly_rent: renewTenancyDto.rentAmount,
        owner_comment: `Tenancy renewed. New rent: ₦${renewTenancyDto.rentAmount.toLocaleString()}, Period: ${startDateStr} to ${endDateStr}, Payment: ${renewTenancyDto.paymentFrequency}. Previous rent: ₦${previousRentalPrice?.toLocaleString() || 'N/A'}`,
      });

      await queryRunner.manager.save(PropertyHistory, historyEntry);

      await queryRunner.commitTransaction();

      // Emit tenancy renewed event for live feed
      this.eventEmitter.emit('tenancy.renewed', {
        property_id: propertyTenant.property_id,
        property_name: propertyTenant.property.name,
        tenant_id: propertyTenant.tenant_id,
        tenant_name: `${propertyTenant.tenant.user.first_name} ${propertyTenant.tenant.user.last_name}`,
        user_id: propertyTenant.property.owner_id,
        rent_amount: renewTenancyDto.rentAmount,
        payment_frequency: renewTenancyDto.paymentFrequency,
        start_date: startDateStr,
        end_date: endDateStr,
      });

      return {
        success: true,
        message: 'Tenancy renewed successfully',
        data: {
          propertyTenant,
          rent: newRent,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
