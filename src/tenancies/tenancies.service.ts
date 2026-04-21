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
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from 'src/notifications/notification.service';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from 'src/tenant-balances/entities/tenant-balance-ledger.entity';
import { rentToFees, renewalInvoiceToFees, sumAll, Fee } from 'src/common/billing/fees';
import { randomUUID } from 'crypto';

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
      cautionDeposit?: number;
      legalFee?: number;
      agencyFee?: number;
      serviceChargeRecurring?: boolean;
      cautionDepositRecurring?: boolean;
      legalFeeRecurring?: boolean;
      agencyFeeRecurring?: boolean;
      otherFees?: Array<{
        externalId?: string;
        name: string;
        amount: number;
        recurring: boolean;
      }>;
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

    // 5. Billing v2 — build the Fee[] for the renewal invoice by merging
    // per-field overrides from the request body over the active rent's
    // current values. Every body field is optional; omitted fields fall
    // back to the rent so "Renew" pre-fills correctly.
    const rentAmount = body?.rentAmount || activeRent.rental_price || 0;
    const serviceCharge =
      body?.serviceCharge ?? (activeRent.service_charge || 0);
    const cautionDeposit =
      body?.cautionDeposit ?? Number(activeRent.security_deposit || 0);
    const legalFee =
      body?.legalFee ?? Number(activeRent.legal_fee || 0);
    const agencyFee =
      body?.agencyFee ?? Number(activeRent.agency_fee || 0);

    const serviceChargeRecurring =
      body?.serviceChargeRecurring ?? activeRent.service_charge_recurring ?? true;
    const cautionDepositRecurring =
      body?.cautionDepositRecurring ?? activeRent.security_deposit_recurring ?? false;
    const legalFeeRecurring =
      body?.legalFeeRecurring ?? activeRent.legal_fee_recurring ?? false;
    const agencyFeeRecurring =
      body?.agencyFeeRecurring ?? activeRent.agency_fee_recurring ?? false;

    const otherFees = (body?.otherFees ?? activeRent.other_fees ?? []).map((f) => ({
      externalId: f.externalId ?? randomUUID(),
      name: f.name,
      amount: f.amount,
      recurring: f.recurring,
    }));

    // Build the Fee[] via the shared helper so the same classification
    // rules apply here as in the rent pipeline.
    const allFees: Fee[] = rentToFees({
      rental_price: rentAmount,
      service_charge: serviceCharge,
      service_charge_recurring: serviceChargeRecurring,
      security_deposit: cautionDeposit,
      security_deposit_recurring: cautionDepositRecurring,
      legal_fee: legalFee,
      legal_fee_recurring: legalFeeRecurring,
      agency_fee: agencyFee,
      agency_fee_recurring: agencyFeeRecurring,
      other_fees: otherFees,
      payment_frequency: paymentFrequency,
    });
    // Landlord-driven renewal bills every fee set in the Edit Tenancy modal
    // (rent + service + caution + legal + agency + otherFees) regardless of
    // the per-fee recurring flag. The recurring flag governs auto-renewal
    // (year 2+ cron), not this current-period invoice.
    const periodCharge = sumAll(allFees);

    const landlordId = propertyTenant.property.owner_id;
    const walletBalance = await this.tenantBalancesService.getBalance(
      propertyTenant.tenant_id,
      landlordId,
    );

    // total = new charges - wallet (credit reduces total; outstanding increases it)
    const totalAmount = Math.max(0, periodCharge - walletBalance);
    // Legacy scalar columns kept in sync with the helper output so existing
    // consumers (PDF, history) see the same numbers as fee_breakdown.
    const otherCharges = 0;

    const isSilent = body?.silent === true;

    const tenantName = `${propertyTenant.tenant.user.first_name} ${propertyTenant.tenant.user.last_name}`;

    // 6. Find-or-create the renewal invoice inside a transaction with row
    // locking so two concurrent calls for the same tenant can't race.
    const { renewalInvoice, token } = await this.dataSource.transaction(
      async (manager) => {
        // Lock any existing unpaid draft/landlord invoice for this tenant to
        // prevent concurrent updates from overwriting each other.
        const existingInvoice = await manager
          .getRepository(RenewalInvoice)
          .createQueryBuilder('ri')
          .setLock('pessimistic_write')
          .where('ri.property_tenant_id = :ptId', {
            ptId: propertyTenantId,
          })
          .andWhere('ri.payment_status = :status', {
            status: RenewalPaymentStatus.UNPAID,
          })
          .andWhere('ri.token_type IN (:...types)', {
            types: ['landlord', 'draft'],
          })
          .andWhere('ri.deleted_at IS NULL')
          .orderBy('ri.created_at', 'DESC')
          .getOne();

        let invoice: RenewalInvoice;

        if (existingInvoice) {
          // Update existing invoice with landlord's chosen terms
          existingInvoice.start_date = startDate;
          existingInvoice.end_date = endDate;
          existingInvoice.rent_amount = rentAmount;
          existingInvoice.service_charge = serviceCharge;
          existingInvoice.legal_fee = legalFee;
          existingInvoice.agency_fee = agencyFee;
          existingInvoice.caution_deposit = cautionDeposit;
          existingInvoice.other_charges = otherCharges;
          existingInvoice.other_fees = otherFees;
          existingInvoice.fee_breakdown = allFees;
          existingInvoice.total_amount = totalAmount;
          existingInvoice.outstanding_balance =
            walletBalance < 0 ? -walletBalance : 0;
          existingInvoice.wallet_balance = walletBalance;
          existingInvoice.payment_frequency = paymentFrequency;
          // Upgrade draft → landlord when the landlord is actually sending the notification
          existingInvoice.token_type = isSilent ? 'draft' : 'landlord';
          invoice = existingInvoice;
        } else {
          // Generate new token and create fresh invoice
          invoice = manager.getRepository(RenewalInvoice).create({
            token: uuidv4(),
            property_tenant_id: propertyTenantId,
            property_id: propertyTenant.property_id,
            tenant_id: propertyTenant.tenant_id,
            start_date: startDate,
            end_date: endDate,
            rent_amount: rentAmount,
            service_charge: serviceCharge,
            legal_fee: legalFee,
            agency_fee: agencyFee,
            caution_deposit: cautionDeposit,
            other_charges: otherCharges,
            other_fees: otherFees,
            fee_breakdown: allFees,
            total_amount: totalAmount,
            outstanding_balance: walletBalance < 0 ? -walletBalance : 0,
            wallet_balance: walletBalance,
            payment_status: RenewalPaymentStatus.UNPAID,
            payment_frequency: paymentFrequency,
            token_type: isSilent ? 'draft' : 'landlord',
          });
        }

        await manager.getRepository(RenewalInvoice).save(invoice);

        if (!isSilent) {
          const historyEntry = manager
            .getRepository(PropertyHistory)
            .create({
              property_id: propertyTenant.property_id,
              tenant_id: propertyTenant.tenant_id,
              event_type: 'renewal_link_sent',
              event_description: `Tenancy renewal link sent to ${tenantName}`,
              owner_comment: `Tenancy renewal link sent to ${tenantName}`,
              related_entity_id: invoice.id,
              related_entity_type: 'renewal_invoice',
            });
          await manager.getRepository(PropertyHistory).save(historyEntry);
        }

        return { renewalInvoice: invoice, token: invoice.token };
      },
    );

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
   * Update the active rent record (landlord edits current tenancy terms).
   *
   * When fee amounts change, existing charge ledger entries linked to this
   * rent are reversed and re-created so the outstanding balance breakdown
   * reflects the corrected charges. Original entries are marked
   * `metadata.superseded = true` and reversals use
   * `related_entity_type = 'rent_edit'` — both are excluded from the
   * breakdown display.
   */
  async updateActiveTenancy(
    propertyTenantId: string,
    userId: string,
    dto: {
      rentAmount: number;
      serviceCharge?: number;
      paymentFrequency: string;
      cautionDeposit?: number;
      legalFee?: number;
      agencyFee?: number;
      serviceChargeRecurring?: boolean;
      cautionDepositRecurring?: boolean;
      legalFeeRecurring?: boolean;
      agencyFeeRecurring?: boolean;
      otherFees?: { externalId?: string; name: string; amount: number; recurring: boolean }[];
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

    // Snapshot the old fees before applying edits
    const oldFees = rentToFees(activeRent);

    // Apply edits to the rent record
    activeRent.rental_price = dto.rentAmount;
    activeRent.service_charge = dto.serviceCharge ?? activeRent.service_charge;
    activeRent.payment_frequency = dto.paymentFrequency;
    if (dto.cautionDeposit !== undefined) activeRent.security_deposit = dto.cautionDeposit;
    if (dto.legalFee !== undefined) activeRent.legal_fee = dto.legalFee;
    if (dto.agencyFee !== undefined) activeRent.agency_fee = dto.agencyFee;
    if (dto.serviceChargeRecurring !== undefined) activeRent.service_charge_recurring = dto.serviceChargeRecurring;
    if (dto.cautionDepositRecurring !== undefined) activeRent.security_deposit_recurring = dto.cautionDepositRecurring;
    if (dto.legalFeeRecurring !== undefined) activeRent.legal_fee_recurring = dto.legalFeeRecurring;
    if (dto.agencyFeeRecurring !== undefined) activeRent.agency_fee_recurring = dto.agencyFeeRecurring;
    if (dto.otherFees !== undefined) {
      activeRent.other_fees = dto.otherFees.map((f) => ({
        externalId: f.externalId ?? randomUUID(),
        name: f.name,
        amount: f.amount,
        recurring: f.recurring,
      }));
    }
    activeRent.updated_at = new Date();

    const newFees = rentToFees(activeRent);

    // Check if charge amounts actually changed
    const oldChargeTotal = oldFees.reduce((s, f) => s + f.amount, 0);
    const newChargeTotal = newFees.reduce((s, f) => s + f.amount, 0);
    const chargesChanged = oldChargeTotal !== newChargeTotal ||
      oldFees.length !== newFees.length ||
      oldFees.some((of, i) => {
        const nf = newFees[i];
        return !nf || of.kind !== nf.kind || of.amount !== nf.amount;
      });

    if (!chargesChanged) {
      // Only non-amount fields changed (e.g. payment frequency, recurring flags)
      await this.rentRepository.save(activeRent);
      return { success: true };
    }

    // Charges changed — reverse old ledger entries and create new ones in a transaction
    const tenantId = propertyTenant.tenant_id;
    const landlordId = propertyTenant.property.owner_id;
    const propertyId = propertyTenant.property_id;
    const rentId = activeRent.id;

    await this.dataSource.transaction(async (manager) => {
      // Save the updated rent record
      await manager.save(activeRent);

      // Find existing charge entries linked to this rent.
      // Exclude already-superseded entries so repeated edits don't double-reverse.
      const existingCharges = await manager.find(TenantBalanceLedger, {
        where: {
          related_entity_id: rentId,
          related_entity_type: 'rent',
          tenant_id: tenantId,
        },
      });

      // Only reverse active charge entries (balance_change < 0, not already superseded)
      const chargeEntries = existingCharges.filter(
        (e) =>
          Number(e.balance_change) < 0 &&
          !(e.metadata as any)?.superseded,
      );

      // If this rent has no ledger entries (pre-ledger tenancy), only save
      // the rent record — don't fabricate charges that were never billed.
      if (chargeEntries.length === 0) {
        return;
      }

      // Collect the set of fee kinds that were originally charged, so we only
      // create replacement entries for those kinds (no retroactive new charges).
      const originalKinds = new Set<string>();
      for (const entry of chargeEntries) {
        const kind = (entry.metadata as any)?.fee_kind as string | undefined;
        if (kind) originalKinds.add(kind);
      }
      // If originals have fee_kind metadata, only replace those kinds.
      // If they don't (pre-Billing v2), replace all — we can't be selective.
      const hasKindMetadata = originalKinds.size > 0;

      // Build a map from fee_kind → original type so replacements keep the right type.
      // Fall back to the first entry's type, then INITIAL_BALANCE.
      const typeByKind = new Map<string, TenantBalanceLedgerType>();
      let fallbackType = TenantBalanceLedgerType.INITIAL_BALANCE;
      for (const entry of chargeEntries) {
        const kind = (entry.metadata as any)?.fee_kind as string | undefined;
        if (kind) {
          typeByKind.set(kind, entry.type);
        }
        fallbackType = entry.type;
      }

      // Build a map from fee_kind → original description prefix so replacements
      // keep the same style (e.g. "New period charged: Oak Apartments — ").
      const descriptionPrefixByKind = new Map<string, string>();
      for (const entry of chargeEntries) {
        const kind = (entry.metadata as any)?.fee_kind as string | undefined;
        if (kind && entry.description) {
          // Extract prefix: everything before the last " — <label>" or use as-is
          const dashIdx = entry.description.lastIndexOf(' \u2014 ');
          if (dashIdx > 0) {
            descriptionPrefixByKind.set(kind, entry.description.substring(0, dashIdx + 3));
          }
        }
      }

      // Mark originals as superseded and reverse them
      for (const entry of chargeEntries) {
        await manager.update(TenantBalanceLedger, entry.id, {
          metadata: { ...(entry.metadata ?? {}), superseded: true },
        });

        const reversalAmount = -Number(entry.balance_change);
        await this.tenantBalancesService.applyChange(
          tenantId,
          landlordId,
          reversalAmount,
          {
            type: entry.type,
            description: `${entry.description} (reversal)`,
            propertyId,
            relatedEntityType: 'rent_edit',
            relatedEntityId: rentId,
            metadata: { reversal_of: entry.id },
          },
          undefined,
          manager,
        );
      }

      // Create replacement charge entries only for fee kinds that were
      // originally charged. Skip new fee kinds the landlord added — those
      // will take effect on the next renewal, not retroactively.
      const feesToCharge = hasKindMetadata
        ? newFees.filter((f) => originalKinds.has(f.kind))
        : newFees;

      for (const fee of feesToCharge) {
        const entryType = typeByKind.get(fee.kind) ?? fallbackType;
        const prefix = descriptionPrefixByKind.get(fee.kind);
        const description = prefix ? `${prefix}${fee.label}` : fee.label;

        await this.tenantBalancesService.applyChange(
          tenantId,
          landlordId,
          -fee.amount,
          {
            type: entryType,
            description,
            propertyId,
            relatedEntityType: 'rent',
            relatedEntityId: rentId,
            metadata: { fee_kind: fee.kind, edited: true },
          },
          undefined,
          manager,
        );
      }
    });

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
      cautionDeposit?: number;
      legalFee?: number;
      agencyFee?: number;
      serviceChargeRecurring?: boolean;
      cautionDepositRecurring?: boolean;
      legalFeeRecurring?: boolean;
      agencyFeeRecurring?: boolean;
      otherFees?: { externalId?: string; name: string; amount: number; recurring: boolean }[];
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

    const rentAmount = dto.rentAmount;
    const serviceCharge = dto.serviceCharge ?? 0;
    const cautionDeposit = dto.cautionDeposit ?? Number(invoice.caution_deposit || 0);
    const legalFee = dto.legalFee ?? Number(invoice.legal_fee || 0);
    const agencyFee = dto.agencyFee ?? Number(invoice.agency_fee || 0);

    const serviceChargeRecurring = dto.serviceChargeRecurring ?? true;
    const cautionDepositRecurring = dto.cautionDepositRecurring ?? false;
    const legalFeeRecurring = dto.legalFeeRecurring ?? false;
    const agencyFeeRecurring = dto.agencyFeeRecurring ?? false;

    const otherFees = (dto.otherFees ?? invoice.other_fees ?? []).map((f) => ({
      externalId: f.externalId ?? randomUUID(),
      name: f.name,
      amount: f.amount,
      recurring: f.recurring,
    }));

    const allFees: Fee[] = rentToFees({
      rental_price: rentAmount,
      service_charge: serviceCharge,
      service_charge_recurring: serviceChargeRecurring,
      security_deposit: cautionDeposit,
      security_deposit_recurring: cautionDepositRecurring,
      legal_fee: legalFee,
      legal_fee_recurring: legalFeeRecurring,
      agency_fee: agencyFee,
      agency_fee_recurring: agencyFeeRecurring,
      other_fees: otherFees,
      payment_frequency: dto.paymentFrequency,
    });
    const periodCharge = sumAll(allFees);

    const landlordId = invoice.property.owner_id;
    const walletBalance = await this.tenantBalancesService.getBalance(
      invoice.tenant_id,
      landlordId,
    );

    const totalAmount = Math.max(0, periodCharge - walletBalance);

    invoice.rent_amount = rentAmount;
    invoice.service_charge = serviceCharge;
    invoice.legal_fee = legalFee;
    invoice.agency_fee = agencyFee;
    invoice.caution_deposit = cautionDeposit;
    invoice.other_fees = otherFees;
    invoice.fee_breakdown = allFees;
    invoice.total_amount = totalAmount;
    invoice.outstanding_balance = walletBalance < 0 ? -walletBalance : 0;
    invoice.wallet_balance = walletBalance;
    invoice.payment_frequency = dto.paymentFrequency;
    invoice.end_date = endDate;

    await this.renewalInvoiceRepository.save(invoice);

    return { success: true, invoiceId: invoice.id, totalAmount };
  }

  /**
   * Recompute `total_amount` / `wallet_balance` / `outstanding_balance` on
   * every unpaid landlord/draft renewal invoice for a (tenant, landlord)
   * pair. `fee_breakdown` is the authoritative charges snapshot; only the
   * wallet-dependent derived fields get refreshed.
   *
   * Call this whenever the ledger changes so downstream consumers (payment
   * plans, PDFs, history) see current numbers without a cron tick.
   */
  @OnEvent('tenant.balance.changed', { async: true })
  async onTenantBalanceChanged(payload: {
    tenantId: string;
    landlordId: string;
  }): Promise<void> {
    await this.refreshInvoiceTotals(payload.tenantId, payload.landlordId);
  }

  async refreshInvoiceTotals(
    tenantId: string,
    landlordId: string,
  ): Promise<void> {
    const invoices = await this.renewalInvoiceRepository
      .createQueryBuilder('ri')
      .innerJoin('ri.property', 'p')
      .where('ri.tenant_id = :tenantId', { tenantId })
      .andWhere('p.owner_id = :landlordId', { landlordId })
      .andWhere('ri.payment_status = :status', {
        status: RenewalPaymentStatus.UNPAID,
      })
      .andWhere('ri.token_type IN (:...types)', {
        types: ['landlord', 'draft', 'tenant'],
      })
      .andWhere('ri.deleted_at IS NULL')
      .getMany();

    if (invoices.length === 0) return;

    const walletBalance = await this.tenantBalancesService.getBalance(
      tenantId,
      landlordId,
    );
    const outstanding = walletBalance < 0 ? -walletBalance : 0;

    const toSave: RenewalInvoice[] = [];
    for (const invoice of invoices) {
      const breakdown: Fee[] = Array.isArray(invoice.fee_breakdown)
        ? invoice.fee_breakdown
        : [];

      if (invoice.token_type === 'tenant') {
        // Tenant-initiated "Pay Outstanding Balance" invoice: total equals
        // the current outstanding portion of the wallet. Keep the single
        // Outstanding Balance fee entry in sync with the wallet. If the
        // outstanding has been cleared elsewhere (e.g. landlord renewal
        // invoice paid), auto-settle so the link doesn't 0-charge anyone.
        invoice.total_amount = outstanding;
        invoice.outstanding_balance = outstanding;
        invoice.wallet_balance = walletBalance;
        invoice.fee_breakdown = breakdown.map((f) =>
          f.externalId === 'outstanding_balance'
            ? { ...f, amount: outstanding }
            : f,
        );
        if (outstanding === 0) {
          invoice.payment_status = RenewalPaymentStatus.PAID;
          invoice.amount_paid = 0;
          invoice.paid_at = new Date();
        }
      } else {
        // Landlord / draft renewal invoice: total is the full charge set
        // (every fee in the breakdown, recurring or not) minus current
        // wallet. `fee_breakdown` is the authoritative snapshot.
        const periodCharge = sumAll(breakdown);
        invoice.total_amount = Math.max(0, periodCharge - walletBalance);
        invoice.wallet_balance = walletBalance;
        invoice.outstanding_balance = outstanding;
      }
      toSave.push(invoice);
    }
    await this.renewalInvoiceRepository.save(toSave);
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
    //   - related_entity_type = 'rent_edit': reversal entries from tenancy charge edits
    //   - metadata.superseded = true: original charges replaced by an edit
    // MIGRATION entries are included — they represent real rent charges at ledger setup.
    const chargeRows = ledgerEntries
      .filter(
        (e) =>
          Number(e.balance_change) < 0 &&
          e.type !== TenantBalanceLedgerType.CREDIT_APPLIED &&
          e.related_entity_type !== 'property_history' &&
          e.related_entity_type !== 'rent_edit' &&
          !(e.metadata as any)?.superseded,
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
        cautionDeposit: parseFloat((invoice.caution_deposit ?? 0).toString()),
        agencyFee: parseFloat((invoice.agency_fee ?? 0).toString()),
        otherFees: (invoice.other_fees ?? []).map((f) => ({
          externalId: f.externalId,
          name: f.name,
          amount: parseFloat((f.amount ?? 0).toString()),
          recurring: !!f.recurring,
        })),
      },
      feeBreakdown: renewalInvoiceToFees(invoice),
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
      receiptToken: invoice.receipt_token || null,
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
    skipLedger: boolean = false,
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

    // Auto-complete any active tenancy-scope payment plans on this invoice
    // when it's paid in full via a lump-sum (not via the plan ripple-up
    // itself — skipLedger=true signals the ripple-up case).
    if (shouldRenew && !skipLedger) {
      await this.autoCompletePaymentPlansForInvoice(
        invoice.id,
        paymentReference,
      );
    }

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
          security_deposit_recurring: activeRent.security_deposit_recurring,
          service_charge:
            parseFloat(invoice.service_charge.toString()) ||
            activeRent.service_charge,
          service_charge_recurring: activeRent.service_charge_recurring,
          legal_fee: activeRent.legal_fee,
          legal_fee_recurring: activeRent.legal_fee_recurring,
          agency_fee: activeRent.agency_fee,
          agency_fee_recurring: activeRent.agency_fee_recurring,
          other_fees: activeRent.other_fees,
          payment_frequency:
            invoice.payment_frequency || activeRent.payment_frequency,
          payment_status: RentPaymentStatusEnum.PAID,
          rent_status: RentStatusEnum.ACTIVE,
        });
        await this.rentRepository.save(newRent);

        // Mirror the charge the auto-renewal cron would have written, so the
        // ledger/breakdown reflects the new period and the payment below
        // consumes it instead of becoming phantom credit.
        const invoiceFees = renewalInvoiceToFees(invoice);
        const recurringFees = invoiceFees.filter((f) => f.recurring);
        const newPeriodStart = new Date(invoice.start_date)
          .toISOString()
          .split('T')[0];
        const newPeriodEnd = new Date(invoice.end_date)
          .toISOString()
          .split('T')[0];
        for (const fee of recurringFees) {
          await this.tenantBalancesService.applyChange(
            tenantId,
            landlordId,
            -fee.amount,
            {
              type: TenantBalanceLedgerType.AUTO_RENEWAL,
              description: `New period charged: ${newPeriodStart} – ${newPeriodEnd} — ${fee.label}`,
              propertyId: invoice.property_id,
              relatedEntityType: 'rent',
              relatedEntityId: newRent.id,
              metadata: {
                fee_kind: fee.kind,
                ...(fee.externalId ? { externalId: fee.externalId } : {}),
                period_start: newPeriodStart,
                period_end: newPeriodEnd,
              },
            },
          );
        }
      }
    }

    // Single wallet entry: payment increases balance (positive change).
    // All payments now go to wallet (no current-charges option)
    const description = `Renewal payment of ₦${amount.toLocaleString()} received`;

    if (!skipLedger) {
      await this.tenantBalancesService.applyChange(
        tenantId,
        landlordId,
        amount,
        {
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description,
          propertyId: invoice.property_id,
          relatedEntityType: 'renewal_invoice',
          relatedEntityId: invoice.id,
        },
      );
    }

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

  /**
   * When a renewal invoice is paid in full via lump-sum, any active
   * tenancy-scope payment plans tied to it are covered by that payment —
   * flip their pending installments to paid and close the plans so
   * reminders stop and the plan UI shows the correct state.
   *
   * Raw SQL avoids a module-level circular dep with PaymentPlansModule.
   */
  private async autoCompletePaymentPlansForInvoice(
    invoiceId: string,
    paymentReference: string,
  ): Promise<void> {
    try {
      const plans: { id: string; property_id: string; tenant_id: string }[] =
        await this.dataSource.query(
          `SELECT id, property_id, tenant_id FROM payment_plans
             WHERE renewal_invoice_id = $1
               AND scope = 'tenancy'
               AND status = 'active'`,
          [invoiceId],
        );

      if (!plans.length) return;

      const now = new Date();
      const note = `Covered by lump-sum invoice payment (${paymentReference})`;

      for (const plan of plans) {
        await this.dataSource.query(
          `UPDATE payment_plan_installments
             SET status = 'paid',
                 paid_at = $1,
                 payment_method = COALESCE(payment_method, 'other'),
                 manual_payment_note = COALESCE(manual_payment_note, $2),
                 paystack_reference = COALESCE(paystack_reference, $3)
             WHERE plan_id = $4 AND status = 'pending'`,
          [now, note, paymentReference, plan.id],
        );

        await this.dataSource.query(
          `UPDATE payment_plans SET status = 'completed', updated_at = $1
             WHERE id = $2`,
          [now, plan.id],
        );

        const histEntry = this.propertyHistoryRepository.create({
          property_id: plan.property_id,
          tenant_id: plan.tenant_id,
          event_type: 'payment_plan_completed',
          event_description: `Payment plan completed — remaining installments covered by lump-sum invoice payment`,
          related_entity_id: plan.id,
          related_entity_type: 'payment_plan',
        });
        await this.propertyHistoryRepository.save(histEntry);
      }
    } catch (err) {
      // Non-blocking: a failure here shouldn't fail the renewal payment.
      console.error(
        '[autoCompletePaymentPlansForInvoice] failed',
        (err as Error)?.message,
      );
    }
  }
}
