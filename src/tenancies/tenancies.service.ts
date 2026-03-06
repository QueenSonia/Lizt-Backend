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
import { WhatsAppNotificationLogService } from 'src/whatsapp-bot/whatsapp-notification-log.service';
import { Users } from 'src/users/entities/user.entity';
import { UtilService } from 'src/utils/utility-service';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from './entities/renewal-invoice.entity';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
    @InjectRepository(RenewalInvoice)
    private renewalInvoiceRepository: Repository<RenewalInvoice>,
    private readonly whatsappBotService: WhatsappBotService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly utilService: UtilService,
    private readonly eventEmitter: EventEmitter2,
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

  /**
   * Generate renewal invoice link and send via WhatsApp
   * Requirements: 1.1, 1.2, 1.3
   */
  async initiateRenewal(
    propertyTenantId: string,
    userId: string,
  ): Promise<{ token: string; link: string }> {
    // 1. Find the PropertyTenant relationship with all necessary relations
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: propertyTenantId },
      relations: ['property', 'property.owner', 'tenant', 'tenant.user'],
    });

    if (!propertyTenant) {
      throw new NotFoundException(
        `Property tenant relationship with ID ${propertyTenantId} not found`,
      );
    }

    // 2. Verify ownership
    if (propertyTenant.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to initiate renewal for this tenancy',
        HttpStatus.FORBIDDEN,
      );
    }

    // 3. Find the active rent record to get renewal details
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
        'Active rent has no expiry date set. Cannot calculate renewal period.',
      );
    }

    // 4. Calculate renewal period (start date = day after expiry, end date = 1 year later)
    const startDate = new Date(activeRent.expiry_date);
    startDate.setDate(startDate.getDate() + 1);

    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    endDate.setDate(endDate.getDate() - 1); // End date is inclusive

    // 5. Calculate total amount (rent + service charge + legal fee)
    const rentAmount = activeRent.rental_price;
    const serviceCharge = activeRent.service_charge || 0;
    const legalFee = rentAmount * 0.05; // 5% legal fee
    const otherCharges = 0;
    const totalAmount = rentAmount + serviceCharge + legalFee + otherCharges;

    // 6. Generate unique token
    const token = uuidv4();

    // 7. Set expiration date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // 8. Create renewal invoice record
    const renewalInvoice = this.renewalInvoiceRepository.create({
      token,
      property_tenant_id: propertyTenantId,
      property_id: propertyTenant.property_id,
      tenant_id: propertyTenant.tenant_id,
      start_date: startDate,
      end_date: endDate,
      rent_amount: rentAmount,
      service_charge: serviceCharge,
      legal_fee: legalFee,
      other_charges: otherCharges,
      total_amount: totalAmount,
      payment_status: RenewalPaymentStatus.UNPAID,
      expires_at: expiresAt,
    });

    // 9. Create property history entry for renewal link sent
    const tenantName = `${propertyTenant.tenant.user.first_name} ${propertyTenant.tenant.user.last_name}`;
    const historyEntry = this.propertyHistoryRepository.create({
      property_id: propertyTenant.property_id,
      tenant_id: propertyTenant.tenant_id,
      event_type: 'renewal_link_sent',
      event_description: `Tenancy renewal link sent to ${tenantName}`,
      owner_comment: `Tenancy renewal link sent to ${tenantName}`,
      related_entity_id: renewalInvoice.id,
      related_entity_type: 'renewal_invoice',
    });

    // 10. Save both records in parallel
    await Promise.all([
      this.renewalInvoiceRepository.save(renewalInvoice),
      this.propertyHistoryRepository.save(historyEntry),
    ]);

    // 11. Generate renewal link
    const baseUrl =
      process.env.RENEWAL_LINK_BASE_URL ||
      'http://localhost:3000/renewal-invoice';
    const link = `${baseUrl}/${token}`;

    // 12. Queue WhatsApp notification asynchronously (fire and forget)
    setImmediate(async () => {
      try {
        const tenantPhone = this.utilService.normalizePhoneNumber(
          propertyTenant.tenant.user.phone_number,
        );

        await this.whatsappNotificationLog.queue('sendRenewalLink', {
          phone_number: tenantPhone,
          tenant_name: tenantName,
          renewal_token: token,
          frontend_url:
            process.env.RENEWAL_LINK_BASE_URL || 'http://localhost:3000',
        });

        console.log(`Renewal link queued for ${tenantPhone}: ${link}`);
      } catch (error) {
        console.error(
          'Error queueing renewal link WhatsApp notification:',
          error,
        );
      }
    });

    return { token, link };
  }

  /**
   * Get renewal invoice data by token
   * Requirements: 4.1-4.7
   */
  async getRenewalInvoice(token: string): Promise<any> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['property', 'tenant', 'tenant.user'],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    // Check if token is expired
    if (invoice.expires_at && new Date() > invoice.expires_at) {
      throw new HttpException(
        'This renewal link has expired. Please contact your landlord for a new link.',
        HttpStatus.GONE,
      );
    }

    // Helper to format dates
    const formatDate = (date: any): string => {
      if (typeof date === 'string') {
        return date.split('T')[0];
      }
      return date.toISOString().split('T')[0];
    };

    // Format response
    return {
      id: invoice.id,
      token: invoice.token,
      propertyName: invoice.property.name,
      propertyAddress: invoice.property.location,
      tenantName: `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`,
      tenantPhone: invoice.tenant.user.phone_number,
      renewalPeriod: {
        startDate: formatDate(invoice.start_date),
        endDate: formatDate(invoice.end_date),
      },
      charges: {
        rentAmount: parseFloat(invoice.rent_amount.toString()),
        serviceCharge: parseFloat(invoice.service_charge.toString()),
        legalFee: parseFloat(invoice.legal_fee.toString()),
        otherCharges: parseFloat(invoice.other_charges.toString()),
      },
      totalAmount: parseFloat(invoice.total_amount.toString()),
      paymentStatus: invoice.payment_status,
      paidAt: invoice.paid_at
        ? typeof invoice.paid_at === 'string'
          ? invoice.paid_at
          : invoice.paid_at.toISOString()
        : null,
      paymentReference: invoice.payment_reference,
    };
  }

  /**
   * Verify renewal token validity
   * Requirements: 12.1
   */
  async verifyRenewalToken(token: string): Promise<boolean> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
    });

    if (!invoice) {
      return false;
    }

    // Check if token is expired
    if (invoice.expires_at && new Date() > invoice.expires_at) {
      return false;
    }

    return true;
  }

  /**
   * Mark invoice as paid and update records
   * Requirements: 5.3, 8.1-8.5
   */
  async markInvoiceAsPaid(
    token: string,
    paymentReference: string,
    amount: number,
  ): Promise<void> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    // Check if already paid
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      throw new HttpException(
        'This invoice has already been paid',
        HttpStatus.CONFLICT,
      );
    }

    // Validate amount matches invoice total
    const invoiceTotal = parseFloat(invoice.total_amount.toString());
    if (Math.abs(amount - invoiceTotal) > 0.01) {
      throw new BadRequestException(
        'Payment amount does not match invoice total',
      );
    }

    // Update invoice payment status
    invoice.payment_status = RenewalPaymentStatus.PAID;
    invoice.payment_reference = paymentReference;
    invoice.paid_at = new Date();

    await this.renewalInvoiceRepository.save(invoice);

    // Send WhatsApp notifications (non-blocking)
    try {
      const tenantPhone = this.utilService.normalizePhoneNumber(
        invoice.tenant.user.phone_number,
      );
      const tenantName = `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`;
      const propertyName = invoice.property.name;

      // Queue tenant payment confirmation
      await this.whatsappNotificationLog.queue('sendRenewalPaymentTenant', {
        phone_number: tenantPhone,
        tenant_name: tenantName,
        amount,
        property_name: propertyName,
      });

      console.log(`Payment confirmation queued for tenant ${tenantPhone}`);

      // Send notification to landlord
      if (invoice.property.owner?.user?.phone_number) {
        const landlordPhone = this.utilService.normalizePhoneNumber(
          invoice.property.owner.user.phone_number,
        );
        const landlordName = invoice.property.owner.user.first_name;

        // Queue landlord payment notification
        await this.whatsappNotificationLog.queue('sendRenewalPaymentLandlord', {
          phone_number: landlordPhone,
          landlord_name: landlordName,
          tenant_name: tenantName,
          amount,
          property_name: propertyName,
        });

        console.log(
          `Payment notification queued for landlord ${landlordPhone}`,
        );
      }
    } catch (error) {
      console.error('Error queueing payment notifications:', error);
      // Non-blocking - continue even if queueing fails
    }

    // Update property history for renewal payment received
    const tenantName = `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`;
    const propertyName = invoice.property.name;
    const propertyHistoryEntry = this.propertyHistoryRepository.create({
      property_id: invoice.property_id,
      tenant_id: invoice.tenant_id,
      event_type: 'renewal_payment_received',
      event_description: `Renewal payment received from ${tenantName}. Amount: ₦${amount.toLocaleString()}, Reference: ${paymentReference}`,
      owner_comment: `Renewal payment received from ${tenantName}. Amount: ₦${amount.toLocaleString()}, Reference: ${paymentReference}`,
      related_entity_id: invoice.id,
      related_entity_type: 'renewal_invoice',
    });

    await this.propertyHistoryRepository.save(propertyHistoryEntry);

    // Create tenant history entry for renewal payment
    const tenantHistoryEntry = this.propertyHistoryRepository.create({
      property_id: invoice.property_id,
      tenant_id: invoice.tenant_id,
      event_type: 'renewal_payment_made',
      event_description: `Payment made for tenancy renewal for property ${propertyName}. Amount: ₦${amount.toLocaleString()}`,
      tenant_comment: `Payment made for tenancy renewal for property ${propertyName}`,
      related_entity_id: invoice.id,
      related_entity_type: 'renewal_invoice',
    });

    await this.propertyHistoryRepository.save(tenantHistoryEntry);

    // Emit event for livefeed
    this.eventEmitter.emit('renewal.payment.received', {
      property_id: invoice.property_id,
      property_name: invoice.property.name,
      tenant_id: invoice.tenant_id,
      tenant_name: tenantName,
      user_id: invoice.property.owner_id,
      amount,
      payment_reference: paymentReference,
      timestamp: new Date().toISOString(),
    });
  }
}
