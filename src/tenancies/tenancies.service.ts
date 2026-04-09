import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
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
import { NotificationService } from 'src/notifications/notification.service';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from 'src/tenant-balances/entities/tenant-balance-ledger.entity';

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
    private readonly notificationService: NotificationService,
    private readonly tenantBalancesService: TenantBalancesService,
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
          property_name: property.name,
          property_id: property_id,
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
    body?: {
      rentAmount: number;
      paymentFrequency: string;
      serviceCharge?: number;
      silent?: boolean;
      endDate?: string;
    },
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

    // 4. Calculate invoice period.
    // If the current rent is already OWING (auto-renewed but unpaid), the invoice
    // covers the current period (tenant pays for what they owe).
    // Otherwise (PAID/PENDING) the invoice is for the upcoming next period.
    const paymentFrequency =
      body?.paymentFrequency || activeRent.payment_frequency || 'Annually';

    let startDate: Date;
    let endDate: Date;

    if (activeRent.payment_status === RentPaymentStatusEnum.OWING) {
      startDate = new Date(activeRent.rent_start_date);
      endDate = new Date(activeRent.expiry_date);
    } else {
      startDate = new Date(activeRent.expiry_date);
      startDate.setDate(startDate.getDate() + 1);

      if (body?.endDate) {
        endDate = new Date(body.endDate);
      } else {
        endDate = new Date(startDate);
        switch (paymentFrequency.toLowerCase()) {
          case 'monthly':
            endDate.setMonth(endDate.getMonth() + 1);
            break;
          case 'quarterly':
            endDate.setMonth(endDate.getMonth() + 3);
            break;
          case 'bi-annually':
            endDate.setMonth(endDate.getMonth() + 6);
            break;
          case 'annually':
          default:
            endDate.setFullYear(endDate.getFullYear() + 1);
            break;
        }
        endDate.setDate(endDate.getDate() - 1); // End date is inclusive
      }
    }

    // 5. Calculate total amount (rent + service charge + outstanding balance - credit balance)
    const rentAmount = body?.rentAmount || activeRent.rental_price;
    const serviceCharge =
      body?.serviceCharge ?? (activeRent.service_charge || 0);
    const legalFee = 0;
    const otherCharges = 0;

    const landlordId = propertyTenant.property.owner_id;
    const walletBalance = await this.tenantBalancesService.getBalance(
      propertyTenant.tenant_id,
      landlordId,
    );

    // total = new charges - wallet (credit reduces total; outstanding increases it)
    const currentCharges = rentAmount + serviceCharge + legalFee + otherCharges;
    const totalAmount = Math.max(0, currentCharges - walletBalance);

    const isSilent = body?.silent === true;

    // 6. Check for existing unpaid renewal invoice (landlord-initiated or draft)
    // Exclude tenant-generated OB-only invoices — those should not be reused as renewal invoices
    const existingInvoice = await this.renewalInvoiceRepository.findOne({
      where: {
        property_tenant_id: propertyTenantId,
        payment_status: RenewalPaymentStatus.UNPAID,
        token_type: In(['landlord', 'draft']),
      },
      order: { created_at: 'DESC' },
    });

    let renewalInvoice: RenewalInvoice;

    if (existingInvoice) {
      // Update existing invoice with landlord's chosen terms
      existingInvoice.start_date = startDate;
      existingInvoice.end_date = endDate;
      existingInvoice.rent_amount = rentAmount;
      existingInvoice.service_charge = serviceCharge;
      existingInvoice.legal_fee = legalFee;
      existingInvoice.other_charges = otherCharges;
      existingInvoice.total_amount = totalAmount;
      existingInvoice.outstanding_balance =
        walletBalance < 0 ? -walletBalance : 0;
      existingInvoice.wallet_balance = walletBalance;
      existingInvoice.payment_frequency = paymentFrequency;
      // Upgrade draft → landlord when the landlord is actually sending the notification
      existingInvoice.token_type = isSilent ? 'draft' : 'landlord';
      renewalInvoice = existingInvoice;
    } else {
      // Generate new token and create fresh invoice
      const token = uuidv4();

      renewalInvoice = this.renewalInvoiceRepository.create({
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
        outstanding_balance: walletBalance < 0 ? -walletBalance : 0,
        wallet_balance: walletBalance,
        payment_status: RenewalPaymentStatus.UNPAID,
        payment_frequency: paymentFrequency,
        token_type: isSilent ? 'draft' : 'landlord',
      });
    }

    const token = renewalInvoice.token;

    const tenantName = `${propertyTenant.tenant.user.first_name} ${propertyTenant.tenant.user.last_name}`;

    if (isSilent) {
      // Silent save — just persist the invoice, no history entry, no notification
      await this.renewalInvoiceRepository.save(renewalInvoice);
    } else {
      // 9. Create property history entry for renewal link sent
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
    }

    if (!isSilent) {
      // Emit event for livefeed (listener will create the detailed notification)
      this.eventEmitter.emit('renewal.link.sent', {
        property_id: propertyTenant.property_id,
        property_name: propertyTenant.property.name,
        tenant_id: propertyTenant.tenant_id,
        tenant_name: tenantName,
        user_id: userId,
        amount: totalAmount,
        timestamp: new Date().toISOString(),
      });
    }

    // 11. Generate renewal link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const baseUrl = `${frontendUrl}/renewal-invoice`;
    const link = `${baseUrl}/${token}`;

    // 12. Queue WhatsApp notification asynchronously (fire and forget)
    // Skip if silent flag is set (landlord is pre-setting terms without notifying tenant yet)
    if (!body?.silent) {
      setImmediate(() => {
        void (async () => {
          try {
            const tenantPhone = this.utilService.normalizePhoneNumber(
              propertyTenant.tenant.user.phone_number,
            );

            await this.whatsappNotificationLog.queue('sendRenewalLink', {
              phone_number: tenantPhone,
              tenant_name: tenantName,
              renewal_token: token,
              frontend_url: frontendUrl,
              landlord_id: userId,
              recipient_name: tenantName,
              property_id: propertyTenant.property_id,
            });

            console.log(`Renewal link queued for ${tenantPhone}: ${link}`);
          } catch (error) {
            console.error(
              'Error queueing renewal link WhatsApp notification:',
              error,
            );
          }
        })();
      });
    }

    return { token, link };
  }

  /**
   * Update the active rent record (landlord edits current tenancy terms)
   */
  async updateActiveTenancy(
    propertyTenantId: string,
    userId: string,
    dto: {
      rentAmount: number;
      serviceCharge?: number;
      paymentFrequency: string;
    },
  ): Promise<{ success: boolean }> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: propertyTenantId },
      relations: ['property'],
    });

    if (!propertyTenant) {
      throw new NotFoundException('Tenancy not found');
    }

    if (propertyTenant.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to edit this tenancy',
        HttpStatus.FORBIDDEN,
      );
    }

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

    activeRent.rental_price = dto.rentAmount;
    activeRent.service_charge = dto.serviceCharge ?? activeRent.service_charge;
    activeRent.payment_frequency = dto.paymentFrequency;
    activeRent.updated_at = new Date();

    await this.rentRepository.save(activeRent);

    return { success: true };
  }

  /**
   * Update an existing unpaid renewal invoice (landlord edits next-period terms)
   */
  async updateRenewalInvoice(
    invoiceId: string,
    userId: string,
    dto: {
      rentAmount: number;
      serviceCharge?: number;
      paymentFrequency: string;
      endDate?: string;
    },
  ): Promise<{ success: boolean; invoiceId: string; totalAmount: number }> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: invoiceId },
      relations: ['property'],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    if (invoice.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to edit this invoice',
        HttpStatus.FORBIDDEN,
      );
    }

    if (invoice.payment_status !== RenewalPaymentStatus.UNPAID) {
      throw new BadRequestException(
        'Cannot edit an invoice that has already been paid',
      );
    }

    // Recalculate end_date from invoice start_date + new frequency (or use custom endDate if provided)
    const startDate = new Date(invoice.start_date);
    let endDate: Date;
    if (dto.endDate) {
      endDate = new Date(dto.endDate);
    } else {
      endDate = new Date(startDate);
      switch (dto.paymentFrequency.toLowerCase()) {
        case 'monthly':
          endDate.setMonth(endDate.getMonth() + 1);
          break;
        case 'quarterly':
          endDate.setMonth(endDate.getMonth() + 3);
          break;
        case 'bi-annually':
          endDate.setMonth(endDate.getMonth() + 6);
          break;
        case 'annually':
        default:
          endDate.setFullYear(endDate.getFullYear() + 1);
          break;
      }
      endDate.setDate(endDate.getDate() - 1);
    }

    const landlordId = invoice.property.owner_id;
    const walletBalance = await this.tenantBalancesService.getBalance(
      invoice.tenant_id,
      landlordId,
    );

    const rentAmount = dto.rentAmount;
    const serviceCharge = dto.serviceCharge ?? 0;
    const currentCharges = rentAmount + serviceCharge;
    const totalAmount = Math.max(0, currentCharges - walletBalance);

    invoice.rent_amount = rentAmount;
    invoice.service_charge = serviceCharge;
    invoice.total_amount = totalAmount;
    invoice.outstanding_balance = walletBalance < 0 ? -walletBalance : 0;
    invoice.wallet_balance = walletBalance;
    invoice.payment_frequency = dto.paymentFrequency;
    invoice.end_date = endDate;

    await this.renewalInvoiceRepository.save(invoice);

    return { success: true, invoiceId: invoice.id, totalAmount };
  }

  /**
   * Get renewal invoice data by token
   * Requirements: 4.1-4.7
   */
  async getRenewalInvoice(token: string): Promise<any> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
        'tenant.user.tenant_kycs',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    return this.formatRenewalInvoiceResponse(invoice);
  }

  /**
   * Get renewal invoice by its database ID (for landlord dashboard)
   */
  async getRenewalInvoiceById(id: string): Promise<any> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
        'tenant.user.tenant_kycs',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    // Reuse the same formatting as getRenewalInvoice
    return this.formatRenewalInvoiceResponse(invoice);
  }

  /**
   * Get wallet history for a renewal invoice, using the same dual-source logic
   * as the landlord breakdown modal:
   *   - Charges: negative ledger entries (excluding CREDIT_APPLIED / MIGRATION)
   *   - Manual payments: property_history (authoritative for edits/deletes)
   *   - Renewal invoice payments: positive ledger entries with related_entity_type = 'renewal_invoice'
   */
  async getInvoiceWalletHistory(token: string): Promise<any[]> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['property'],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    const tenantId = invoice.tenant_id;
    const landlordId = invoice.property.owner_id;

    const [ledgerEntries, manualPaymentHistories, rentRecords] =
      await Promise.all([
        this.tenantBalancesService.getLedger(tenantId, landlordId),
        this.propertyHistoryRepository.find({
          where: { tenant_id: tenantId, event_type: 'user_added_payment' },
          relations: ['property'],
        }),
        this.rentRepository.find({
          where: { tenant_id: tenantId },
          relations: ['property'],
        }),
      ]);

    // Build lookup maps for date resolution (mirrors tenant-management.service.ts logic)
    const rentMap = new Map<string, Rent>();
    rentRecords
      .filter((r) => r.property?.owner_id === landlordId)
      .forEach((r) => rentMap.set(r.id, r));

    const propertyHistoryMap = new Map<string, PropertyHistory>();
    manualPaymentHistories.forEach((ph) => {
      if (ph.id) propertyHistoryMap.set(ph.id, ph);
    });

    // Charges: negative ledger entries. Exclude:
    //   - CREDIT_APPLIED: legacy artifact from old two-step payment flow
    //   - related_entity_type = 'property_history': reversal entries created when a manual
    //     payment is edited/deleted — accounting artifacts, not real charges
    // MIGRATION entries are included — they represent real rent charges at ledger setup.
    const chargeRows = ledgerEntries
      .filter(
        (e) =>
          Number(e.balance_change) < 0 &&
          e.type !== TenantBalanceLedgerType.CREDIT_APPLIED &&
          e.related_entity_type !== 'property_history',
      )
      .map((e) => {
        // Apply the same date resolution and description enrichment as tenant-management
        let date: Date;
        // Normalize migration entries to the same label as initial_balance charges
        const baseDescription =
          e.type === TenantBalanceLedgerType.MIGRATION
            ? 'Historical tenancy recorded'
            : e.description || String(e.type);
        let description = baseDescription;

        if (e.related_entity_type === 'rent' && e.related_entity_id) {
          const relatedRent = rentMap.get(e.related_entity_id);
          if (relatedRent?.rent_start_date) {
            date = new Date(relatedRent.rent_start_date);
            const endDate = relatedRent.expiry_date
              ? new Date(relatedRent.expiry_date)
              : null;
            if (endDate) {
              const startStr = date.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });
              const endStr = endDate.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });
              description = `${description} (${startStr} - ${endStr})`;
            }
          } else {
            date = new Date(e.created_at!);
          }
        } else if (
          e.related_entity_type === 'property_history' &&
          e.related_entity_id
        ) {
          const relatedPH = propertyHistoryMap.get(e.related_entity_id);
          date = relatedPH?.move_in_date
            ? new Date(relatedPH.move_in_date)
            : new Date(e.created_at!);
        } else {
          date = new Date(e.created_at!);
        }

        return {
          id: `charge-${e.id}`,
          date,
          description,
          balanceChange: parseFloat((e.balance_change ?? 0).toString()),
        };
      });

    // Manual payments from property_history (edits update in-place; deletes remove the row)
    const manualPaymentRows = manualPaymentHistories
      .filter((ph) => ph.property?.owner_id === landlordId)
      .map((ph) => {
        try {
          const data = JSON.parse(ph.event_description || '{}');
          const amount = Number(data.paymentAmount || 0);
          if (amount <= 0) return null;
          return {
            id: `payment-history-${ph.id}`,
            date: ph.move_in_date
              ? new Date(ph.move_in_date)
              : new Date(ph.created_at!),
            description: data.description || 'Payment received',
            balanceChange: amount, // positive = balance increased for tenant
          };
        } catch {
          return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Renewal invoice payments from ledger (no property_history row exists for these)
    const renewalPaymentRows = ledgerEntries
      .filter(
        (e) =>
          Number(e.balance_change) > 0 &&
          e.related_entity_type === 'renewal_invoice',
      )
      .map((e) => ({
        id: `renewal-${e.id}`,
        date: e.created_at as Date,
        description: e.description || 'Renewal payment',
        balanceChange: parseFloat((e.balance_change ?? 0).toString()),
      }));

    // Merge, sort chronologically, and compute running balance
    const allRows = [
      ...chargeRows,
      ...manualPaymentRows,
      ...renewalPaymentRows,
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    return allRows.map((row) => {
      running += row.balanceChange;
      return {
        id: row.id,
        date: row.date,
        description: row.description,
        balanceChange: row.balanceChange,
        balanceAfter: running,
      };
    });
  }

  /**
   * Format renewal invoice entity into API response
   */
  private formatRenewalInvoiceResponse(invoice: RenewalInvoice): any {
    const formatDate = (date: any): string => {
      if (typeof date === 'string') {
        return date.split('T')[0];
      }
      return date.toISOString().split('T')[0];
    };

    const landlordUser = invoice.property.owner?.user;
    const landlordBranding = landlordUser?.branding || null;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] || landlordBranding?.letterhead || null;

    const tenantUser = invoice.tenant.user;
    const tenantKyc = tenantUser.tenant_kycs?.[0];
    const tenantEmail =
      tenantKyc?.email ?? invoice.tenant.email ?? tenantUser.email;

    return {
      id: invoice.id,
      token: invoice.token,
      propertyName: invoice.property.name,
      propertyAddress: invoice.property.location,
      tenantName: `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`,
      tenantEmail: tenantEmail,
      tenantPhone: invoice.tenant.user.phone_number,
      renewalPeriod: {
        startDate: formatDate(invoice.start_date),
        endDate: formatDate(invoice.end_date),
      },
      charges: {
        rentAmount: parseFloat((invoice.rent_amount ?? 0).toString()),
        serviceCharge: parseFloat((invoice.service_charge ?? 0).toString()),
        legalFee: parseFloat((invoice.legal_fee ?? 0).toString()),
        otherCharges: parseFloat((invoice.other_charges ?? 0).toString()),
      },
      totalAmount: parseFloat((invoice.total_amount ?? 0).toString()),
      outstandingBalance: parseFloat(
        (invoice.outstanding_balance || 0).toString(),
      ),
      walletBalance: parseFloat((invoice.wallet_balance ?? 0).toString()),
      tokenType: invoice.token_type || 'landlord',
      paymentStatus: invoice.payment_status,
      pendingApproval:
        invoice.payment_status === RenewalPaymentStatus.PENDING_APPROVAL,
      approvalStatus: invoice.approval_status || null,
      paidAt: invoice.paid_at
        ? typeof invoice.paid_at === 'string'
          ? invoice.paid_at
          : invoice.paid_at.toISOString()
        : null,
      paymentReference: invoice.payment_reference,
      landlordBranding: landlordBranding,
      landlordLogoUrl: landlordLogoUrl,
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

    return true;
  }

  /**
   * Get payment success page data
   * Requirements: 1.1-1.7
   */
  async getPaymentSuccessData(token: string): Promise<any> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
        'tenant.user.tenant_kycs',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    // Check if invoice is paid
    if (invoice.payment_status !== RenewalPaymentStatus.PAID) {
      throw new HttpException(
        'Invoice not paid - success data not available',
        HttpStatus.GONE,
      );
    }

    return {
      invoiceToken: invoice.token,
      receiptToken: invoice.receipt_token,
      invoice: this.formatRenewalInvoiceResponse(invoice),
      paymentReference: invoice.payment_reference,
      paidAt: invoice.paid_at
        ? typeof invoice.paid_at === 'string'
          ? invoice.paid_at
          : invoice.paid_at.toISOString()
        : null,
    };
  }

  /**
   * Get renewal receipt data by receipt token
   * Requirements: 4.1-4.8, 8.1-8.3
   */
  async getRenewalReceiptByToken(receiptToken: string): Promise<any> {
    // Find invoice by receipt token
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { receipt_token: receiptToken },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
        'tenant.user.tenant_kycs',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Receipt not found');
    }

    // Check if invoice is paid (access control requirement 8.3)
    if (invoice.payment_status !== RenewalPaymentStatus.PAID) {
      throw new HttpException(
        'Receipt not available - payment required',
        HttpStatus.GONE,
      );
    }

    // Format receipt data
    return this.formatRenewalReceiptResponse(invoice);
  }

  /**
   * Format renewal invoice entity into receipt response
   * Requirements: 4.1-4.8, 5.1-5.6
   */
  private formatRenewalReceiptResponse(invoice: RenewalInvoice): any {
    const formatDate = (date: any): string => {
      if (typeof date === 'string') {
        return date.split('T')[0];
      }
      return date.toISOString().split('T')[0];
    };

    const formatDateTime = (date: any): string => {
      if (typeof date === 'string') {
        return date;
      }
      return date.toISOString();
    };

    const landlordUser = invoice.property.owner?.user;
    const landlordBranding = landlordUser?.branding || null;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] || landlordBranding?.letterhead || null;

    const tenantUser = invoice.tenant.user;
    const tenantKyc = tenantUser.tenant_kycs?.[0];
    const tenantEmail =
      tenantKyc?.email ?? invoice.tenant.email ?? tenantUser.email;

    return {
      receiptNumber: invoice.receipt_number,
      receiptDate: formatDateTime(invoice.paid_at || new Date()),
      transactionReference: invoice.payment_reference,

      // Tenant Information
      tenantName: `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`,
      tenantEmail: tenantEmail,
      tenantPhone: invoice.tenant.user.phone_number,

      // Property Information
      propertyName: invoice.property.name,
      propertyAddress: invoice.property.location,

      // Payment Breakdown
      charges: {
        rentAmount: parseFloat(invoice.rent_amount.toString()),
        serviceCharge:
          parseFloat(invoice.service_charge.toString()) || undefined,
        legalFee: parseFloat(invoice.legal_fee.toString()) || undefined,
        otherCharges: parseFloat(invoice.other_charges.toString()) || undefined,
      },
      totalAmount: parseFloat(invoice.total_amount.toString()),
      /**
       * Signed wallet balance at invoice creation.
       * positive = credit was applied (reduced the total)
       * negative = previous outstanding was added (increased the total)
       */
      walletBalance: parseFloat((invoice.wallet_balance ?? 0).toString()),
      /** Actual amount paid by the tenant (may differ from totalAmount for partial payments) */
      amountPaid:
        invoice.amount_paid !== null
          ? parseFloat(invoice.amount_paid.toString())
          : null,

      // Payment Details
      paymentDate: formatDateTime(invoice.paid_at || new Date()),
      paymentMethod: invoice.payment_method || null,

      // Branding
      landlordBranding: landlordBranding,
      landlordLogoUrl: landlordLogoUrl,
    };
  }

  /**
   * Mark invoice as paid and update records.
   * Supports flexible payment options when outstanding balance exists:
   * - 'current-charges': renew tenancy, OB carries forward
   * - 'outstanding': pay OB only, no renewal
   * - 'full': renew tenancy + clear OB
   * - 'custom': depends on amount vs current charges
   * - undefined: backwards-compatible full renewal (no OB on invoice)
   */
  async markInvoiceAsPaid(
    token: string,
    paymentReference: string,
    amount: number,
    paymentOption?: string,
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

    // Check if already fully paid
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      throw new HttpException(
        'This invoice has already been paid',
        HttpStatus.CONFLICT,
      );
    }

    // Calculate total invoice amount for renewal logic
    const totalInvoiceAmount = parseFloat(invoice.total_amount.toString());

    // Tenant-generated invoices never trigger renewal — only landlords control tenancy renewal
    // For custom payments, always trigger renewal if amount >= total invoice amount
    const shouldRenew =
      invoice.token_type !== 'tenant' &&
      (paymentOption === 'full' ||
        (paymentOption === 'custom' && amount >= totalInvoiceAmount) ||
        !paymentOption); // backwards compat: no option = old flow = always renew

    // Update invoice payment status - no advance payment logic
    invoice.payment_status = shouldRenew
      ? RenewalPaymentStatus.PAID
      : RenewalPaymentStatus.PARTIAL;
    invoice.payment_reference = paymentReference;
    invoice.paid_at = new Date();
    invoice.amount_paid = amount;

    await this.renewalInvoiceRepository.save(invoice);

    // Get the active rent record
    const activeRent = await this.rentRepository.findOne({
      where: {
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });

    const landlordId = invoice.property.owner_id;
    const tenantId = invoice.tenant_id;

    if (shouldRenew && activeRent) {
      const isOwingRent =
        activeRent.payment_status === RentPaymentStatusEnum.OWING;

      if (isOwingRent) {
        // --- MARK CURRENT OWING RENT PAID ---
        // Auto-renewal already created this period; just mark it paid.
        // Also sync rental_price/service_charge/payment_frequency from the invoice
        // so that future auto-renewals carry the landlord's chosen amount forward.
        activeRent.payment_status = RentPaymentStatusEnum.PAID;
        activeRent.amount_paid = parseFloat(invoice.rent_amount.toString());
        activeRent.rental_price = parseFloat(invoice.rent_amount.toString());
        activeRent.service_charge =
          parseFloat((invoice.service_charge || 0).toString()) ||
          activeRent.service_charge;
        activeRent.payment_frequency =
          invoice.payment_frequency || activeRent.payment_frequency;
        activeRent.updated_at = new Date();
        await this.rentRepository.save(activeRent);
      } else {
        // --- OLD FLOW: current rent was PAID/PENDING (pre-expiry payment) ---
        // Mark current period inactive and create new PAID rent for next period.
        activeRent.rent_status = RentStatusEnum.INACTIVE;
        activeRent.updated_at = new Date();
        await this.rentRepository.save(activeRent);

        const newRent = this.rentRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          rent_start_date: invoice.start_date,
          expiry_date: invoice.end_date,
          rental_price: parseFloat(invoice.rent_amount.toString()),
          amount_paid: parseFloat(invoice.rent_amount.toString()),
          security_deposit: activeRent.security_deposit,
          service_charge:
            parseFloat(invoice.service_charge.toString()) ||
            activeRent.service_charge,
          payment_frequency:
            invoice.payment_frequency || activeRent.payment_frequency,
          payment_status: RentPaymentStatusEnum.PAID,
          rent_status: RentStatusEnum.ACTIVE,
        });
        await this.rentRepository.save(newRent);
      }
    }

    // Single wallet entry: payment increases balance (positive change).
    // All payments now go to wallet (no current-charges option)
    const description = `Renewal payment of ₦${amount.toLocaleString()} received`;

    await this.tenantBalancesService.applyChange(tenantId, landlordId, amount, {
      type: TenantBalanceLedgerType.OB_PAYMENT,
      description,
      propertyId: invoice.property_id,
      relatedEntityType: 'renewal_invoice',
      relatedEntityId: invoice.id,
    });

    // Recalculate balance for notifications (negative = still owes)
    const newWalletBalance = await this.tenantBalancesService.getBalance(
      tenantId,
      landlordId,
    );
    const newOutstandingBalance = newWalletBalance < 0 ? -newWalletBalance : 0;

    // Common data for notifications
    const tenantName = `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`;
    const propertyName = invoice.property.name;

    // Send WhatsApp notifications (non-blocking)
    try {
      const tenantPhone = this.utilService.normalizePhoneNumber(
        invoice.tenant.user.phone_number,
      );
      if (shouldRenew) {
        await this.whatsappNotificationLog.queue('sendRenewalPaymentTenant', {
          phone_number: tenantPhone,
          tenant_name: tenantName,
          amount,
          property_name: propertyName,
          receipt_token: invoice.receipt_token,
          landlord_id: invoice.property.owner_id,
          recipient_name: tenantName,
          property_id: invoice.property_id,
        });

        // Send notification to landlord
        if (invoice.property.owner?.user?.phone_number) {
          const landlordPhone = this.utilService.normalizePhoneNumber(
            invoice.property.owner.user.phone_number,
          );
          const landlordName = invoice.property.owner.user.first_name;

          await this.whatsappNotificationLog.queue(
            'sendRenewalPaymentLandlord',
            {
              phone_number: landlordPhone,
              landlord_name: landlordName,
              tenant_name: tenantName,
              amount,
              property_name: propertyName,
              landlord_id: invoice.property.owner_id,
              recipient_name: landlordName,
              property_id: invoice.property_id,
            },
          );
        }
      } else {
        // OB-only or partial custom payment — no renewal
        await this.whatsappNotificationLog.queue(
          'sendOutstandingBalancePaidTenant',
          {
            phone_number: tenantPhone,
            tenant_name: tenantName,
            amount,
            property_name: propertyName,
            remaining_balance: newOutstandingBalance,
            landlord_id: invoice.property.owner_id,
            recipient_name: tenantName,
          },
        );

        if (invoice.property.owner?.user?.phone_number) {
          const landlordPhone = this.utilService.normalizePhoneNumber(
            invoice.property.owner.user.phone_number,
          );
          const landlordName = invoice.property.owner.user.first_name;

          await this.whatsappNotificationLog.queue(
            'sendOutstandingBalancePaidLandlord',
            {
              phone_number: landlordPhone,
              landlord_name: landlordName,
              tenant_name: tenantName,
              amount,
              property_name: propertyName,
              remaining_balance: newOutstandingBalance,
              landlord_id: invoice.property.owner_id,
              recipient_name: landlordName,
            },
          );
        }
      }
    } catch (error) {
      console.error('Error queueing payment notifications:', error);
      // Non-blocking - continue even if queueing fails
    }

    // Property history entries - no advance payment logic
    if (shouldRenew) {
      const historyDescription = `Renewal payment received from ${tenantName}. Amount: ₦${amount.toLocaleString()}, Reference: ${paymentReference}`;

      const propertyHistoryEntry = this.propertyHistoryRepository.create({
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        event_type: 'renewal_payment_received',
        event_description: historyDescription,
        owner_comment: historyDescription,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
      });
      await this.propertyHistoryRepository.save(propertyHistoryEntry);

      const tenantHistoryDescription = `Payment made for tenancy renewal for property ${propertyName}. Amount: ₦${amount.toLocaleString()}`;

      const tenantHistoryEntry = this.propertyHistoryRepository.create({
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        event_type: 'renewal_payment_made',
        event_description: tenantHistoryDescription,
        tenant_comment: tenantHistoryDescription,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
      });
      await this.propertyHistoryRepository.save(tenantHistoryEntry);
    } else {
      const obHistoryEntry = this.propertyHistoryRepository.create({
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        event_type: 'outstanding_balance_payment',
        event_description: `Outstanding balance payment received from ${tenantName}. Amount: ₦${amount.toLocaleString()}, Remaining: ₦${newOutstandingBalance.toLocaleString()}`,
        owner_comment: `Outstanding balance payment of ₦${amount.toLocaleString()} received from ${tenantName}`,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
      });
      await this.propertyHistoryRepository.save(obHistoryEntry);
    }

    // Create notification for livefeed
    try {
      const description = shouldRenew
        ? `Renewal payment received from ${tenantName} — ₦${amount.toLocaleString()}`
        : `Outstanding balance payment of ₦${amount.toLocaleString()} received from ${tenantName}`;

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.RENEWAL_PAYMENT_RECEIVED,
        description,
        status: 'Completed',
        property_id: invoice.property_id,
        user_id: invoice.property.owner_id,
      });
    } catch (error) {
      console.error(
        'Failed to create renewal_payment_received notification:',
        error,
      );
    }
  }

  /**
   * Log renewal payment initiated event to property history
   */
  async logRenewalPaymentInitiated(
    invoiceId: string,
    propertyId: string,
    tenantId: string,
    tenantName: string,
    propertyName: string,
  ): Promise<void> {
    const entry = this.propertyHistoryRepository.create({
      property_id: propertyId,
      tenant_id: tenantId,
      event_type: 'renewal_payment_initiated',
      event_description: `Renewal payment initiated by ${tenantName} for property ${propertyName}.`,
      related_entity_id: invoiceId,
      related_entity_type: 'renewal_invoice',
    });
    await this.propertyHistoryRepository.save(entry);
  }

  /**
   * Log renewal payment cancelled event to property history
   */
  async logRenewalPaymentCancelled(token: string): Promise<void> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['property', 'tenant', 'tenant.user'],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    const tenantName = `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`;
    const propertyName = invoice.property.name;

    const entry = this.propertyHistoryRepository.create({
      property_id: invoice.property_id,
      tenant_id: invoice.tenant_id,
      event_type: 'renewal_payment_cancelled',
      event_description: `Renewal payment cancelled by ${tenantName} for property ${propertyName}.`,
      related_entity_id: invoice.id,
      related_entity_type: 'renewal_invoice',
    });
    await this.propertyHistoryRepository.save(entry);
  }
}
