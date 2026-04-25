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
  RenewalLetterStatus,
} from './entities/renewal-invoice.entity';
import { sanitizeLetterHtml } from 'src/common/html/sanitize-letter-html';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from 'src/notifications/notification.service';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from 'src/tenant-balances/entities/tenant-balance-ledger.entity';
import { AdHocInvoiceLineItem } from 'src/ad-hoc-invoices/entities/ad-hoc-invoice-line-item.entity';
import { TenantKyc } from 'src/tenant-kyc/entities/tenant-kyc.entity';
import { rentToFees, renewalInvoiceToFees, sumAll, Fee } from 'src/common/billing/fees';
import {
  calculateRentExpiryDate,
  normalizeFrequency,
  effectiveFrequency,
  nextPeriodEndInclusive,
  StandardFrequency,
  RENT_REMINDER_SCHEDULE,
} from 'src/common/utils/rent-date.util';
import {
  RentChangeImpactDto,
  RentChangeIssueDto,
} from './dto/rent-change-impact.dto';
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
    @InjectRepository(AdHocInvoiceLineItem)
    private adHocInvoiceLineItemRepository: Repository<AdHocInvoiceLineItem>,
    @InjectRepository(TenantKyc)
    private tenantKycRepository: Repository<TenantKyc>,
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
        const landlordName =
          property.owner.profile_name ||
          `${property.owner.user.first_name ?? ''} ${property.owner.user.last_name ?? ''}`.trim() ||
          'Your Landlord';
        await this.whatsappBotService.sendTenantAttachmentNotification({
          phone_number: this.utilService.normalizePhoneNumber(
            tenantUser.phone_number,
          ),
          tenant_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          landlord_name: landlordName,
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
      const newExpiryDate = calculateRentExpiryDate(
        newStartDate,
        renewTenancyDto.paymentFrequency,
      );

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
      startDate?: string;
      acknowledgedIssueIds?: string[];
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
      letterBodyHtml?: string;
      letterBodyFields?: Record<string, unknown>;
    },
  ): Promise<{
    token: string;
    link: string;
    activeInvoiceId: string;
    supersededInvoiceId: string | null;
    letterStatus: RenewalLetterStatus;
  }> {
    // 1. Find the PropertyTenant relationship with all necessary relations
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: propertyTenantId },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
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
      if (body?.startDate) {
        startDate = new Date(body.startDate);
      } else {
        startDate = new Date(activeRent.expiry_date);
        startDate.setDate(startDate.getDate() + 1);
      }

      // Reject overlap with the current tenancy period. If the landlord picks
      // a start date on or before the active rent's expiry, the renewal would
      // double-cover days already billed under the current period — and after
      // payment lands `markInvoiceAsPaid` would write that overlapping range
      // onto the new rent row. Block at the boundary so the invoice never
      // gets persisted with bad dates.
      if (body?.startDate) {
        const currentExpiry = new Date(activeRent.expiry_date);
        currentExpiry.setUTCHours(0, 0, 0, 0);
        const requestedStart = new Date(startDate);
        requestedStart.setUTCHours(0, 0, 0, 0);
        if (requestedStart.getTime() <= currentExpiry.getTime()) {
          throw new BadRequestException(
            `Start date overlaps the current tenancy period (ends ${currentExpiry
              .toISOString()
              .slice(0, 10)}). Choose a date after that day.`,
          );
        }
      }

      if (body?.endDate) {
        endDate = new Date(body.endDate);
      } else if (normalizeFrequency(paymentFrequency) === 'custom') {
        // Custom frequency requires an explicit endDate from the caller.
        throw new BadRequestException(
          'endDate is required when paymentFrequency is custom.',
        );
      } else {
        endDate = calculateRentExpiryDate(startDate, paymentFrequency);
      }
    }

    // Run impact preview and enforce blocker acknowledgement.
    const renewalImpact = await this.buildImpact(
      activeRent,
      {
        rentAmount: body?.rentAmount ?? activeRent.rental_price ?? 0,
        paymentFrequency,
        rentStartDate: startDate,
        expiryDate: endDate,
      },
      'renewal',
    );
    this.assertBlockersAcknowledged(renewalImpact, body?.acknowledgedIssueIds);

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

    const landlordAccount = propertyTenant.property.owner;
    const landlordName =
      landlordAccount?.profile_name ||
      `${landlordAccount?.user?.first_name ?? ''} ${landlordAccount?.user?.last_name ?? ''}`
        .trim() ||
      'Your Landlord';

    const sanitizedLetterHtml = sanitizeLetterHtml(body?.letterBodyHtml);
    const letterBodyFields = body?.letterBodyFields ?? null;

    // 6. Version-aware upsert inside a transaction with pessimistic row
    // locking. Editing a letter that's already `sent` or `accepted` creates
    // a NEW row that supersedes the previous one (we can't mutate a row
    // whose token is in the wild — WhatsApp links must stay auditable).
    const { invoice, supersededInvoiceId } = await this.dataSource.transaction(
      async (manager) => {
        // Lock the latest open (non-superseded, non-paid) row for this
        // property_tenant so two concurrent saves can't race on the version
        // decision. A PAID row terminates the current renewal cycle — the
        // next renewal is a brand-new row that doesn't supersede the paid
        // one (the paid row is a completed chapter, not a "previous version"
        // to revise).
        const existingInvoice = await manager
          .getRepository(RenewalInvoice)
          .createQueryBuilder('ri')
          .setLock('pessimistic_write')
          .where('ri.property_tenant_id = :ptId', { ptId: propertyTenantId })
          .andWhere('ri.superseded_by_id IS NULL')
          .andWhere('ri.payment_status != :paid', {
            paid: RenewalPaymentStatus.PAID,
          })
          .andWhere('ri.deleted_at IS NULL')
          .orderBy('ri.created_at', 'DESC')
          .getOne();

        // Only supersede rows that the landlord actually authored a letter
        // for via the new flow (letter_body_html non-null). Rows that are
        // 'accepted' but have no body — cron auto-create or legacy
        // migration backfill — have no real letter / OTP to protect, so
        // editing them is safe in-place. Without this gate the landlord
        // would accumulate a chain of useless superseded rows whenever
        // they tweak terms on an auto-renewal.
        const hasAuthoredLetter =
          !!existingInvoice && existingInvoice.letter_body_html != null;
        const shouldSupersede =
          hasAuthoredLetter &&
          (existingInvoice!.letter_status === RenewalLetterStatus.SENT ||
            existingInvoice!.letter_status === RenewalLetterStatus.ACCEPTED);

        const nextLetterStatus = isSilent
          ? RenewalLetterStatus.DRAFT
          : RenewalLetterStatus.SENT;

        let invoice: RenewalInvoice;
        let superseded: string | null = null;

        if (existingInvoice && !shouldSupersede) {
          // In-place edit: still draft or was previously declined.
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
          existingInvoice.token_type = isSilent ? 'draft' : 'landlord';
          // Only overwrite letter body when the landlord supplied one.
          // (The landlord may be sending a previously-saved draft as-is.)
          if (sanitizedLetterHtml !== null) {
            existingInvoice.letter_body_html = sanitizedLetterHtml;
          }
          if (letterBodyFields !== null) {
            existingInvoice.letter_body_fields = letterBodyFields;
          }
          existingInvoice.letter_status = nextLetterStatus;
          if (!isSilent) {
            existingInvoice.letter_sent_at = new Date();
          }
          invoice = existingInvoice;
        } else if (existingInvoice && shouldSupersede) {
          // Create a NEW version. Seed the letter body from the previous
          // row so the landlord's edits land on top of what was there.
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
            letter_body_html:
              sanitizedLetterHtml ?? existingInvoice.letter_body_html,
            letter_body_fields:
              letterBodyFields ?? existingInvoice.letter_body_fields,
            letter_status: nextLetterStatus,
            letter_sent_at: isSilent ? null : new Date(),
            supersedes_id: existingInvoice.id,
          });
          await manager.getRepository(RenewalInvoice).save(invoice);

          // Lock the old row: non-null superseded_by_id redirects live
          // traffic away from the stale token everywhere we gate on it.
          existingInvoice.superseded_by_id = invoice.id;
          existingInvoice.superseded_at = new Date();
          await manager.getRepository(RenewalInvoice).save(existingInvoice);
          superseded = existingInvoice.id;
        } else {
          // No existing row — fresh renewal.
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
            letter_body_html: sanitizedLetterHtml,
            letter_body_fields: letterBodyFields,
            letter_status: nextLetterStatus,
            letter_sent_at: isSilent ? null : new Date(),
          });
        }

        await manager.getRepository(RenewalInvoice).save(invoice);

        if (!isSilent) {
          const historyEntry = manager
            .getRepository(PropertyHistory)
            .create({
              property_id: propertyTenant.property_id,
              tenant_id: propertyTenant.tenant_id,
              event_type: 'renewal_letter_sent',
              event_description: `Tenancy renewal letter sent to ${tenantName}`,
              owner_comment: `Tenancy renewal letter sent to ${tenantName}`,
              related_entity_id: invoice.id,
              related_entity_type: 'renewal_invoice',
            });
          await manager.getRepository(PropertyHistory).save(historyEntry);
        }

        return { invoice, supersededInvoiceId: superseded };
      },
    );

    const token = invoice.token;

    if (!isSilent) {
      this.eventEmitter.emit('renewal.letter.sent', {
        property_id: propertyTenant.property_id,
        property_name: propertyTenant.property.name,
        tenant_id: propertyTenant.tenant_id,
        tenant_name: tenantName,
        user_id: userId,
        amount: totalAmount,
        timestamp: new Date().toISOString(),
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // New flow: the tenant opens the letter page first; the payment page at
    // /renewal-invoice/{token} is only reachable after they accept via OTP.
    const link = `${frontendUrl}/renewal-letters/${token}`;

    if (!isSilent) {
      setImmediate(() => {
        void (async () => {
          try {
            const tenantPhone = this.utilService.normalizePhoneNumber(
              propertyTenant.tenant.user.phone_number,
            );

            await this.whatsappNotificationLog.queue('sendRenewalLetterLink', {
              phone_number: tenantPhone,
              tenant_name: tenantName,
              property_name: propertyTenant.property.name,
              landlord_name: landlordName,
              renewal_token: token,
              landlord_id: userId,
              recipient_name: tenantName,
              property_id: propertyTenant.property_id,
            });

            console.log(`Renewal letter link queued for ${tenantPhone}: ${link}`);
          } catch (error) {
            console.error(
              'Error queueing renewal letter WhatsApp notification:',
              error,
            );
          }
        })();
      });
    }

    return {
      token,
      link,
      activeInvoiceId: invoice.id,
      supersededInvoiceId,
      letterStatus: invoice.letter_status,
    };
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
      rentStartDate?: string;
      endDate?: string;
      cautionDeposit?: number;
      legalFee?: number;
      agencyFee?: number;
      serviceChargeRecurring?: boolean;
      cautionDepositRecurring?: boolean;
      legalFeeRecurring?: boolean;
      agencyFeeRecurring?: boolean;
      otherFees?: { externalId?: string; name: string; amount: number; recurring: boolean }[];
      acknowledgedIssueIds?: string[];
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

    // Run the impact preview and refuse unless every blocker was acknowledged.
    // This is pre-transaction; the caller saw these exact issues when their
    // preview call ran, so we just validate their response here.
    const proposed = this.buildProposedFromActiveRentDto(activeRent, dto);
    const impact = await this.buildImpact(activeRent, proposed, 'active_rent');
    this.assertBlockersAcknowledged(impact, dto.acknowledgedIssueIds);

    // Snapshot before state for audit (property_histories RENT_PERIOD_AMENDED)
    const beforeSnapshot = {
      rent_start_date: activeRent.rent_start_date,
      expiry_date: activeRent.expiry_date,
      payment_frequency: activeRent.payment_frequency,
      rental_price: activeRent.rental_price,
    };

    // Snapshot the old fees before applying edits
    const oldFees = rentToFees(activeRent);

    // Apply edits to the rent record
    activeRent.rental_price = dto.rentAmount;
    activeRent.service_charge = dto.serviceCharge ?? activeRent.service_charge;
    activeRent.payment_frequency = dto.paymentFrequency;
    if (dto.rentStartDate) activeRent.rent_start_date = new Date(dto.rentStartDate);
    if (dto.endDate) activeRent.expiry_date = new Date(dto.endDate);
    else if (
      dto.rentStartDate &&
      normalizeFrequency(dto.paymentFrequency) !== 'custom'
    ) {
      // Start moved, no explicit end — recompute end from frequency.
      activeRent.expiry_date = calculateRentExpiryDate(
        activeRent.rent_start_date,
        dto.paymentFrequency,
      );
    }
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

    // Recurring-flag deltas (e.g. landlord flipped Service Charge from
    // one-time to recurring). These change nothing about the current
    // period's charges, but matter for the audit trail / timeline.
    const recurringChanges = computeRecurringChanges(oldFees, newFees);

    // Check if charge amounts actually changed
    const oldChargeTotal = oldFees.reduce((s, f) => s + f.amount, 0);
    const newChargeTotal = newFees.reduce((s, f) => s + f.amount, 0);
    const chargesChanged = oldChargeTotal !== newChargeTotal ||
      oldFees.length !== newFees.length ||
      oldFees.some((of, i) => {
        const nf = newFees[i];
        return !nf || of.kind !== nf.kind || of.amount !== nf.amount;
      });

    const afterSnapshot = {
      rent_start_date: activeRent.rent_start_date,
      expiry_date: activeRent.expiry_date,
      payment_frequency: activeRent.payment_frequency,
      rental_price: activeRent.rental_price,
    };
    const periodOrFrequencyChanged =
      !datesEqual(beforeSnapshot.rent_start_date, afterSnapshot.rent_start_date) ||
      !datesEqual(beforeSnapshot.expiry_date, afterSnapshot.expiry_date) ||
      beforeSnapshot.payment_frequency !== afterSnapshot.payment_frequency;

    if (!chargesChanged) {
      // Only non-amount fields changed (e.g. payment frequency, recurring flags, dates)
      await this.rentRepository.save(activeRent);
      if (periodOrFrequencyChanged || recurringChanges.length > 0) {
        await this.writeRentPeriodAmendedHistory(
          propertyTenant.property_id,
          propertyTenant.tenant_id,
          activeRent.id,
          beforeSnapshot,
          afterSnapshot,
          impact.issues,
          dto.acknowledgedIssueIds ?? [],
          recurringChanges,
        );
      }
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

      // Inside this branch charges changed by definition, so always log an
      // amendment entry — the timeline builder renders rental_price deltas
      // from the before/after metadata even when dates/frequency stayed put.
      const historyEntry = manager
        .getRepository(PropertyHistory)
        .create({
          property_id: propertyId,
          tenant_id: tenantId,
          event_type: 'rent_period_amended',
          event_description: rentPeriodAmendedDescription(
            beforeSnapshot,
            afterSnapshot,
            recurringChanges,
          ),
          related_entity_id: rentId,
          related_entity_type: 'rent',
          metadata: {
            before: beforeSnapshot,
            after: afterSnapshot,
            recurring_changes: recurringChanges,
            acknowledged_issues: (dto.acknowledgedIssueIds ?? []).filter(
              (id) => impact.issues.some((i) => i.id === id),
            ),
          },
        });
      await manager.getRepository(PropertyHistory).save(historyEntry);
    });

    return { success: true };
  }

  /**
   * Write a `rent_period_amended` property_histories entry when dates,
   * frequency, or recurring-flag changes happen outside the existing
   * ledger-rewrite transaction (i.e. amounts didn't change, so no
   * reconciliation ran). Uses the default repo since there's no outer
   * transaction to join.
   */
  private async writeRentPeriodAmendedHistory(
    propertyId: string,
    tenantId: string,
    rentId: string,
    before: RentPeriodSnapshot,
    after: RentPeriodSnapshot,
    allIssues: RentChangeIssueDto[],
    acknowledgedIds: string[],
    recurringChanges: RecurringChange[] = [],
  ): Promise<void> {
    const entry = this.propertyHistoryRepository.create({
      property_id: propertyId,
      tenant_id: tenantId,
      event_type: 'rent_period_amended',
      event_description: rentPeriodAmendedDescription(
        before,
        after,
        recurringChanges,
      ),
      related_entity_id: rentId,
      related_entity_type: 'rent',
      metadata: {
        before,
        after,
        recurring_changes: recurringChanges,
        acknowledged_issues: acknowledgedIds.filter((id) =>
          allIssues.some((i) => i.id === id),
        ),
      },
    });
    await this.propertyHistoryRepository.save(entry);
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
      acknowledgedIssueIds?: string[];
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
    } else if (normalizeFrequency(dto.paymentFrequency) === 'custom') {
      throw new BadRequestException(
        'endDate is required when paymentFrequency is custom.',
      );
    } else {
      endDate = calculateRentExpiryDate(startDate, dto.paymentFrequency);
    }

    // Impact preview + acknowledgement gate. For invoice_edit context most
    // detectors are silent — the period IS the invoice — but renewal payment
    // plans and OB shifts can still surface.
    const activeRentForImpact = await this.rentRepository.findOne({
      where: {
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });
    const invoiceImpact = await this.buildImpact(
      activeRentForImpact ?? ({
        id: invoice.id,
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        payment_frequency: invoice.payment_frequency,
        rent_start_date: invoice.start_date,
        expiry_date: invoice.end_date,
      } as unknown as Rent),
      {
        rentAmount: dto.rentAmount,
        paymentFrequency: dto.paymentFrequency,
        rentStartDate: startDate,
        expiryDate: endDate,
      },
      'invoice_edit',
      invoice,
    );
    this.assertBlockersAcknowledged(invoiceImpact, dto.acknowledgedIssueIds);

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

      const isOutstandingBalanceInvoice =
        invoice.token_type === 'tenant' &&
        Number(invoice.rent_amount || 0) === 0 &&
        breakdown.some((f) => f.externalId === 'outstanding_balance');

      if (isOutstandingBalanceInvoice) {
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
        // Landlord / draft renewal invoice, or a tenant-initiated payment
        // plan request carrying the full fee set. Total is the full charge
        // set (every fee in the breakdown, recurring or not) minus current
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

    // Gate the payment page behind letter acceptance + current-version.
    // (OB / tenant-initiated tokens bypass this gate — they have no letter.)
    const isLandlordInvoice = invoice.token_type === 'landlord';
    if (isLandlordInvoice && invoice.superseded_by_id) {
      throw new HttpException(
        'This invoice has been updated. Your landlord has sent you a revised offer letter — please open the latest link from your WhatsApp.',
        HttpStatus.GONE,
      );
    }
    if (
      isLandlordInvoice &&
      invoice.letter_status !== RenewalLetterStatus.ACCEPTED &&
      invoice.payment_status !== RenewalPaymentStatus.PAID
    ) {
      throw new HttpException(
        "Your landlord's offer letter hasn't been accepted yet. Please open the renewal letter link sent to your WhatsApp and accept it before paying.",
        HttpStatus.FORBIDDEN,
      );
    }

    return await this.formatRenewalInvoiceResponse(invoice);
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
    return await this.formatRenewalInvoiceResponse(invoice);
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

    // Bulk-fetch ad-hoc invoice line items so charges can be split per fee.
    const adHocInvoiceIds = Array.from(
      new Set(
        ledgerEntries
          .filter(
            (e) =>
              e.related_entity_type === 'ad_hoc_invoice' && e.related_entity_id,
          )
          .map((e) => e.related_entity_id as string),
      ),
    );
    const adHocLineItemsByInvoiceId = new Map<string, AdHocInvoiceLineItem[]>();
    if (adHocInvoiceIds.length > 0) {
      const items = await this.adHocInvoiceLineItemRepository.find({
        where: { invoice_id: In(adHocInvoiceIds) },
        order: { sequence: 'ASC' },
      });
      items.forEach((li) => {
        const arr = adHocLineItemsByInvoiceId.get(li.invoice_id) || [];
        arr.push(li);
        adHocLineItemsByInvoiceId.set(li.invoice_id, arr);
      });
    }

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
      .flatMap((e) => {
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

        // Ad-hoc invoices: split into one row per line item so each fee shows
        // by name. Falls back to a single row if line items are missing.
        if (e.related_entity_type === 'ad_hoc_invoice' && e.related_entity_id) {
          const lineItems = adHocLineItemsByInvoiceId.get(e.related_entity_id);
          if (lineItems && lineItems.length > 0) {
            return lineItems.map((li) => ({
              id: `charge-${e.id}-${li.id}`,
              date,
              description: li.description,
              balanceChange: -Number(li.amount), // negative = charge
            }));
          }
        }

        return [
          {
            id: `charge-${e.id}`,
            date,
            description,
            balanceChange: parseFloat((e.balance_change ?? 0).toString()),
          },
        ];
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
   * Resolve the tenant-facing email for a given renewal invoice.
   *
   * Uses the KYC row scoped to the invoice's landlord (matches
   * LandlordPersonDetail's view of the tenant), falling back to the tenant's
   * own Account email then User email. Landlord-scoping prevents leaking
   * another landlord's KYC email onto this receipt.
   */
  private async resolveTenantEmail(invoice: RenewalInvoice): Promise<string> {
    const tenantUser = invoice.tenant.user;
    const tenantKyc = await this.tenantKycRepository.findOne({
      where: {
        user_id: tenantUser.id,
        admin_id: invoice.property.owner_id,
      },
      order: { updated_at: 'DESC' },
    });
    return tenantKyc?.email ?? invoice.tenant.email ?? tenantUser.email;
  }

  /**
   * Format renewal invoice entity into API response
   */
  private async formatRenewalInvoiceResponse(
    invoice: RenewalInvoice,
  ): Promise<any> {
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

    const tenantEmail = await this.resolveTenantEmail(invoice);

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
      invoice: await this.formatRenewalInvoiceResponse(invoice),
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
    return await this.formatRenewalReceiptResponse(invoice);
  }

  /**
   * Format renewal invoice entity into receipt response
   * Requirements: 4.1-4.8, 5.1-5.6
   */
  private async formatRenewalReceiptResponse(
    invoice: RenewalInvoice,
  ): Promise<any> {
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

    const tenantEmail = await this.resolveTenantEmail(invoice);

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
        // Auto-renewal cron already created this period using the *previous*
        // rent's frequency-computed dates and carried-forward fees. Now that
        // payment has landed against the renewal_invoice — which carries the
        // landlord's actual intended dates and fee amounts — reconcile both:
        //
        //  1. Snapshot what the cron already debited (from the rent row, which
        //     mirrors what was posted to the ledger at auto-renewal time).
        //  2. Sync rental_price / service_charge / fees / payment_frequency
        //     AND start_date / expiry_date from the invoice onto the rent.
        //  3. For each recurring fee whose amount changed (or that was added /
        //     removed entirely), post a corrective ledger delta so the wallet
        //     reflects what the landlord actually charged for this period.
        const prevRecurringFees = rentToFees(activeRent).filter(
          (f) => f.recurring,
        );

        // Sync money fields onto the rent row. Use explicit null-checks
        // (not `||`) so that a deliberate 0 from the invoice — i.e. the
        // landlord removing a fee at renewal — overwrites the previous
        // value instead of falling back to it. Otherwise zeroed-out fees
        // would silently persist on the rent row and re-bill on the
        // next auto-renewal.
        activeRent.payment_status = RentPaymentStatusEnum.PAID;
        activeRent.amount_paid = parseFloat(invoice.rent_amount.toString());
        activeRent.rental_price = parseFloat(invoice.rent_amount.toString());
        activeRent.service_charge =
          invoice.service_charge != null
            ? parseFloat(invoice.service_charge.toString())
            : activeRent.service_charge;
        activeRent.legal_fee =
          invoice.legal_fee != null
            ? parseFloat(invoice.legal_fee.toString())
            : activeRent.legal_fee;
        activeRent.agency_fee =
          invoice.agency_fee != null
            ? parseFloat(invoice.agency_fee.toString())
            : activeRent.agency_fee;
        activeRent.other_fees = invoice.other_fees ?? activeRent.other_fees;
        activeRent.payment_frequency =
          invoice.payment_frequency || activeRent.payment_frequency;

        // Sync dates so the landlord's edits to start_date/end_date win over
        // the cron's frequency-computed defaults. The cron computes dates
        // purely from frequency; the invoice carries explicit dates the
        // landlord set in the renewal letter. Without this, edited dates are
        // silently discarded whenever the cron auto-renews before payment.
        if (invoice.start_date) activeRent.rent_start_date = invoice.start_date;
        if (invoice.end_date) activeRent.expiry_date = invoice.end_date;
        activeRent.updated_at = new Date();
        await this.rentRepository.save(activeRent);

        // Reconcile recurring-fee deltas against the ledger. Build a key →
        // amount map for both sides keyed by (kind, externalId) so otherFees
        // are matched by stable id rather than label.
        if (!skipLedger) {
          const newRecurringFees = renewalInvoiceToFees(invoice).filter(
            (f) => f.recurring,
          );
          const feeKey = (f: Fee): string =>
            f.kind === 'other'
              ? `other:${f.externalId ?? f.label}`
              : `${f.kind}`;
          const prevByKey = new Map(prevRecurringFees.map((f) => [feeKey(f), f]));
          const newByKey = new Map(newRecurringFees.map((f) => [feeKey(f), f]));
          const allKeys = new Set([...prevByKey.keys(), ...newByKey.keys()]);

          const periodStart = new Date(activeRent.rent_start_date)
            .toISOString()
            .split('T')[0];
          const periodEnd = new Date(activeRent.expiry_date)
            .toISOString()
            .split('T')[0];

          for (const key of allKeys) {
            const prev = prevByKey.get(key);
            const next = newByKey.get(key);
            const prevAmount = prev ? prev.amount : 0;
            const nextAmount = next ? next.amount : 0;
            if (prevAmount === nextAmount) continue;

            // delta = old - new. Negative delta = increase (more debit needed);
            // positive = decrease (refund the over-charge). applyChange is a
            // signed wallet movement, so a negative delta widens the debit.
            const delta = prevAmount - nextAmount;
            const label = (next ?? prev)!.label;
            const kind = (next ?? prev)!.kind;
            const externalId = (next ?? prev)!.externalId;
            const description =
              prev && next
                ? `Period charge adjusted: ${label} ₦${prevAmount.toLocaleString()} → ₦${nextAmount.toLocaleString()} (${periodStart} – ${periodEnd})`
                : next
                  ? `New period charged: ${periodStart} – ${periodEnd} — ${label}`
                  : `Period charge removed: ${label} (${periodStart} – ${periodEnd})`;

            await this.tenantBalancesService.applyChange(
              tenantId,
              landlordId,
              delta,
              {
                type: TenantBalanceLedgerType.AUTO_RENEWAL,
                description,
                propertyId: invoice.property_id,
                relatedEntityType: 'rent',
                relatedEntityId: activeRent.id,
                metadata: {
                  fee_kind: kind,
                  ...(externalId ? { externalId } : {}),
                  period_start: periodStart,
                  period_end: periodEnd,
                  reconciliation: true,
                  prev_amount: prevAmount,
                  new_amount: nextAmount,
                },
              },
            );
          }
        }
      } else {
        // --- OLD FLOW: current rent was PAID/PENDING (pre-expiry payment) ---
        // Mark current period inactive and create new PAID rent for next period.
        // Source the new rent's fees from the invoice (which carries what the
        // landlord set in the renewal letter), falling back to the previous
        // rent only when the invoice doesn't carry that field. Without this,
        // any otherFees / legal_fee / agency_fee changes the landlord made in
        // the letter would only affect period 1 (via the explicit ledger-debit
        // loop below) and silently revert on the next auto-renewal because
        // the cron carries forward from the rent row.
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
            invoice.service_charge != null
              ? parseFloat(invoice.service_charge.toString())
              : activeRent.service_charge,
          service_charge_recurring: activeRent.service_charge_recurring,
          legal_fee:
            invoice.legal_fee != null
              ? parseFloat(invoice.legal_fee.toString())
              : activeRent.legal_fee,
          legal_fee_recurring: activeRent.legal_fee_recurring,
          agency_fee:
            invoice.agency_fee != null
              ? parseFloat(invoice.agency_fee.toString())
              : activeRent.agency_fee,
          agency_fee_recurring: activeRent.agency_fee_recurring,
          other_fees: invoice.other_fees ?? activeRent.other_fees,
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
          period_start: invoice.start_date,
          period_end: invoice.end_date,
          rent_amount: parseFloat(invoice.rent_amount.toString()),
          service_charge: parseFloat((invoice.service_charge ?? 0).toString()),
          payment_frequency: invoice.payment_frequency ?? 'monthly',
          landlord_id: invoice.property.owner_id,
          recipient_name: tenantName,
          property_id: invoice.property_id,
        });

        // Send notification to landlord
        if (invoice.property.owner?.user?.phone_number) {
          const landlordPhone = this.utilService.normalizePhoneNumber(
            invoice.property.owner.user.phone_number,
          );
          const landlordName =
            invoice.property.owner.profile_name ||
            invoice.property.owner.user.first_name;

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
          const landlordName =
            invoice.property.owner.profile_name ||
            invoice.property.owner.user.first_name;

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

  // =========================================================================
  // Rent-change impact preview
  //
  // Dry-run the proposed date/frequency/amount changes and return a typed
  // list of downstream issues + the computed new period. Mutation endpoints
  // re-run this and refuse if a blocker-severity issue has not been
  // acknowledged by the caller.
  // =========================================================================

  /**
   * Throw 409 with the full issue list if any blocker in `impact` is not
   * present in `acknowledged`. Warnings and info pass through.
   */
  private assertBlockersAcknowledged(
    impact: RentChangeImpactDto,
    acknowledged: string[] | undefined,
  ): void {
    const ack = new Set(acknowledged ?? []);
    const unacked = impact.issues.filter(
      (i) => i.severity === 'blocker' && !ack.has(i.id),
    );
    if (unacked.length === 0) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        message:
          'Unacknowledged blocker issues — pass their ids in acknowledgedIssueIds to proceed',
        issues: unacked,
      },
      HttpStatus.CONFLICT,
    );
  }

  /**
   * PATCH /tenancies/:id/active-rent preview. Runs all applicable detectors
   * against the ACTIVE rent for the given property-tenant relationship.
   */
  async previewActiveRentUpdate(
    propertyTenantId: string,
    userId: string,
    dto: UpdateRenewalInvoiceDtoLike,
  ): Promise<RentChangeImpactDto> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: propertyTenantId },
      relations: ['property'],
    });
    if (!propertyTenant) throw new NotFoundException('Tenancy not found');
    if (propertyTenant.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to preview this tenancy',
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
      throw new NotFoundException('No active rent record found for this tenancy');
    }

    const proposed = this.buildProposedFromActiveRentDto(activeRent, dto);
    return this.buildImpact(activeRent, proposed, 'active_rent');
  }

  /**
   * POST /tenancies/:id/initiate-renewal preview. Same detectors, but the
   * proposed period represents the NEXT period (starting after the current
   * expiry) rather than an in-flight edit.
   */
  async previewRenewal(
    propertyTenantId: string,
    userId: string,
    dto: InitiateRenewalDtoLike,
  ): Promise<RentChangeImpactDto> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: propertyTenantId },
      relations: ['property'],
    });
    if (!propertyTenant) throw new NotFoundException('Tenancy not found');
    if (propertyTenant.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to preview this renewal',
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
      throw new NotFoundException('No active rent record found for this tenancy');
    }
    if (!activeRent.expiry_date) {
      throw new BadRequestException(
        'Active rent has no expiry date set. Cannot preview renewal period.',
      );
    }

    const proposed = this.buildProposedFromRenewalDto(activeRent, dto);
    return this.buildImpact(activeRent, proposed, 'renewal');
  }

  /**
   * PATCH /tenancies/renewal-invoice/by-id/:invoiceId preview. Uses the
   * invoice's own start_date as the anchor (unlike the renewal preview
   * which derives start from the rent's expiry).
   */
  async previewRenewalInvoiceUpdate(
    invoiceId: string,
    userId: string,
    dto: UpdateRenewalInvoiceDtoLike,
  ): Promise<RentChangeImpactDto> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: invoiceId },
      relations: ['property'],
    });
    if (!invoice) throw new NotFoundException('Renewal invoice not found');
    if (invoice.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to preview this invoice',
        HttpStatus.FORBIDDEN,
      );
    }
    if (invoice.payment_status !== RenewalPaymentStatus.UNPAID) {
      throw new BadRequestException(
        'Cannot preview an edit against a paid invoice',
      );
    }

    // Attach-to-rent context — the active rent for the same property-tenant
    // is what governs reminders / auto-renewal. If the invoice is for a
    // renewal that hasn't landed yet, that's still the reference.
    const activeRent = await this.rentRepository.findOne({
      where: {
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });

    const proposed = this.buildProposedFromInvoiceDto(invoice, dto);
    // For invoice edits, detectors run against the invoice itself (it IS the
    // next period) — pass the invoice as the "rent" context so period-shaped
    // detectors compare against its current dates.
    return this.buildImpact(activeRent ?? (invoice as any), proposed, 'invoice_edit', invoice);
  }

  // --- Proposed-change builders ---------------------------------------------

  private buildProposedFromActiveRentDto(
    rent: Rent,
    dto: UpdateRenewalInvoiceDtoLike,
  ): ProposedRentChange {
    const frequency = dto.paymentFrequency || rent.payment_frequency || 'Monthly';
    const rentStartDate = dto.rentStartDate
      ? new Date(dto.rentStartDate)
      : new Date(rent.rent_start_date);
    let expiryDate: Date;
    if (dto.endDate) {
      expiryDate = new Date(dto.endDate);
    } else if (normalizeFrequency(frequency) === 'custom') {
      // Custom + no endDate = hold existing expiry (landlord is mid-edit).
      expiryDate = new Date(rent.expiry_date);
    } else {
      expiryDate = calculateRentExpiryDate(rentStartDate, frequency);
    }
    return {
      rentAmount: dto.rentAmount,
      paymentFrequency: frequency,
      rentStartDate,
      expiryDate,
    };
  }

  private buildProposedFromRenewalDto(
    rent: Rent,
    dto: InitiateRenewalDtoLike,
  ): ProposedRentChange {
    const frequency = dto.paymentFrequency || rent.payment_frequency || 'Annually';
    let startDate: Date;
    if (dto.startDate) {
      startDate = new Date(dto.startDate);
    } else {
      startDate = new Date(rent.expiry_date);
      startDate.setDate(startDate.getDate() + 1);
    }
    let expiryDate: Date;
    if (dto.endDate) {
      expiryDate = new Date(dto.endDate);
    } else if (normalizeFrequency(frequency) === 'custom') {
      // Holding pattern — caller is mid-edit; show the computed field as equal
      // to startDate so the UI renders a "pick an end date" state.
      expiryDate = new Date(startDate);
    } else {
      expiryDate = calculateRentExpiryDate(startDate, frequency);
    }
    return {
      rentAmount: dto.rentAmount,
      paymentFrequency: frequency,
      rentStartDate: startDate,
      expiryDate,
    };
  }

  private buildProposedFromInvoiceDto(
    invoice: RenewalInvoice,
    dto: UpdateRenewalInvoiceDtoLike,
  ): ProposedRentChange {
    const frequency = dto.paymentFrequency || invoice.payment_frequency || 'Monthly';
    // Invoice start_date is fixed (it anchors the tenant-facing token).
    const rentStartDate = new Date(invoice.start_date);
    let expiryDate: Date;
    if (dto.endDate) {
      expiryDate = new Date(dto.endDate);
    } else if (normalizeFrequency(frequency) === 'custom') {
      expiryDate = new Date(invoice.end_date);
    } else {
      expiryDate = calculateRentExpiryDate(rentStartDate, frequency);
    }
    return {
      rentAmount: dto.rentAmount,
      paymentFrequency: frequency,
      rentStartDate,
      expiryDate,
    };
  }

  // --- Core impact builder --------------------------------------------------

  private async buildImpact(
    rent: Rent,
    proposed: ProposedRentChange,
    context: PreviewContext,
    invoice?: RenewalInvoice,
  ): Promise<RentChangeImpactDto> {
    const issues: RentChangeIssueDto[] = [];

    // Detectors — each returns 0+ issues. Run sequentially; they may query
    // the DB. Keep detector methods small and single-purpose.
    issues.push(
      ...(await this.detectRenewalInvoiceStalePeriod(rent, proposed, context, invoice)),
    );
    issues.push(...(await this.detectSentReminderReplay(rent, proposed, context)));
    issues.push(
      ...(await this.detectRenewalPaymentPlanDrift(rent, proposed, context)),
    );
    issues.push(...(await this.detectOBPaymentPlanShift(rent, proposed, context)));
    issues.push(...(await this.detectSpecificChargePlan(rent, proposed, context)));
    issues.push(
      ...(await this.detectPaymentPlanExtendsBeyondPeriod(rent, proposed, context)),
    );
    // detectAdHocInvoiceBalanceShift — info-only, deferred; fee-kind shift
    // math overlaps with updateActiveTenancy's own reconciliation pass.

    const effFreq: StandardFrequency = effectiveFrequency({
      payment_frequency: proposed.paymentFrequency,
      rent_start_date: proposed.rentStartDate,
      expiry_date: proposed.expiryDate,
    });

    // For active-rent edits, the "next period" means the next full period
    // starting the day after the new expiry. For renewal / invoice_edit
    // contexts, the proposed period *is* the next period.
    let nextPeriodStart: Date;
    let nextPeriodEnd: Date;
    if (context === 'active_rent') {
      nextPeriodStart = new Date(proposed.expiryDate);
      nextPeriodStart.setDate(nextPeriodStart.getDate() + 1);
      nextPeriodEnd = nextPeriodEndInclusive(nextPeriodStart, {
        payment_frequency: proposed.paymentFrequency,
        rent_start_date: proposed.rentStartDate,
        expiry_date: proposed.expiryDate,
      });
    } else {
      nextPeriodStart = proposed.rentStartDate;
      nextPeriodEnd = proposed.expiryDate;
    }

    return {
      issues,
      computed: {
        effectiveFrequency: effFreq,
        nextPeriodStart: toISODate(nextPeriodStart),
        nextPeriodEnd: toISODate(nextPeriodEnd),
        newOutstanding: 0, // filled in when detectors run ledger-shift math
      },
    };
  }

  // --- Detectors (plan: 8 total; implementing progressively) ----------------

  /**
   * Un-paid renewal invoices whose start_date no longer matches the day after
   * the proposed rent expiry. Severity depends on token_type per D2 policy:
   *   draft   → silent (updated in place, no issue surfaced)
   *   landlord/tenant → blocker (link in the wild)
   */
  private async detectRenewalInvoiceStalePeriod(
    rent: Rent,
    proposed: ProposedRentChange,
    context: PreviewContext,
    editingInvoice?: RenewalInvoice,
  ): Promise<RentChangeIssueDto[]> {
    // For active-rent edits the "new invoice start" should be expiry + 1.
    // For renewal-preview / invoice-edit contexts the proposed period IS the
    // invoice period, so there is no stale-invoice concept to flag here.
    if (context !== 'active_rent') return [];

    const expectedStart = new Date(proposed.expiryDate);
    expectedStart.setDate(expectedStart.getDate() + 1);

    const invoices = await this.renewalInvoiceRepository
      .createQueryBuilder('ri')
      .where('ri.property_tenant_id IS NOT NULL')
      .andWhere('ri.property_id = :pid', { pid: rent.property_id })
      .andWhere('ri.tenant_id = :tid', { tid: rent.tenant_id })
      .andWhere('ri.payment_status = :status', {
        status: RenewalPaymentStatus.UNPAID,
      })
      .andWhere('ri.deleted_at IS NULL')
      .getMany();

    const issues: RentChangeIssueDto[] = [];
    for (const inv of invoices) {
      if (editingInvoice && inv.id === editingInvoice.id) continue;

      const invStart = new Date(inv.start_date);
      if (isSameDay(invStart, expectedStart)) continue;

      if (inv.token_type === 'draft') continue; // silent — will be re-aligned at send time

      // token_type 'landlord' or 'tenant': public link in the wild.
      issues.push({
        id: `stale_renewal_invoice:${inv.id}`,
        severity: 'blocker',
        kind: 'stale_renewal_invoice',
        description:
          `A ${inv.token_type === 'tenant' ? 'tenant-facing' : 'landlord-sent'} renewal invoice anchored at ${toISODate(invStart)} ` +
          `no longer lines up with the proposed period (expected start ${toISODate(expectedStart)}). ` +
          `Acknowledging records the desync in property history; the invoice row is left alone because its token may already be in the tenant's inbox.`,
        suggestedFix: {
          label: 'Acknowledge desync and proceed',
          action: 'acknowledge_only',
        },
      });
    }
    return issues;
  }

  /**
   * Warn when today's days-until-new-expiry matches a reminder-schedule
   * offset that has not yet been logged — i.e. the cron would fire a
   * reminder today as a side-effect of the date change. Not a blocker; the
   * user just needs to know a tenant message is imminent.
   */
  private async detectSentReminderReplay(
    rent: Rent,
    proposed: ProposedRentChange,
    context: PreviewContext,
  ): Promise<RentChangeIssueDto[]> {
    if (context !== 'active_rent') return [];
    if (!rent.id) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(proposed.expiryDate);
    expiry.setHours(0, 0, 0, 0);
    const daysUntil = Math.floor(
      (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    const freq = effectiveFrequency({
      payment_frequency: proposed.paymentFrequency,
      rent_start_date: proposed.rentStartDate,
      expiry_date: proposed.expiryDate,
    });
    const schedule = RENT_REMINDER_SCHEDULE[freq] ?? RENT_REMINDER_SCHEDULE.monthly;
    if (!schedule.includes(daysUntil)) return [];

    return [
      {
        id: `reminder_replay:${rent.id}:${toISODate(today)}:${daysUntil}`,
        severity: 'warning',
        kind: 'reminder_replay',
        description:
          `With the new expiry date (${toISODate(expiry)}), the tenant is now ${daysUntil} day${daysUntil === 1 ? '' : 's'} away from expiry — ` +
          `a date that normally triggers a rent reminder. If we haven't already sent this reminder today, ` +
          `the tenant will receive a WhatsApp message shortly after you save.`,
        suggestedFix: {
          label: 'Acknowledge — I expect the tenant reminder',
          action: 'acknowledge_only',
        },
      },
    ];
  }

  /**
   * Per D2: renewal payment plans (scope=tenancy, tied to a renewal invoice)
   * are bypassable blockers — their installment due_dates were derived from
   * the old period. We record the desync in history on acknowledge; the
   * landlord voids/refunds via the existing payment-plan flow if they want
   * a clean reset. Reschedule-in-place is out of scope here.
   */
  private async detectRenewalPaymentPlanDrift(
    rent: Rent,
    proposed: ProposedRentChange,
    context: PreviewContext,
  ): Promise<RentChangeIssueDto[]> {
    if (context === 'invoice_edit') return [];

    const plans: Array<{ id: string; charge_name: string }> =
      await this.dataSource.query(
        `SELECT id, charge_name FROM payment_plans
           WHERE property_id = $1 AND tenant_id = $2
             AND scope = 'tenancy'
             AND renewal_invoice_id IS NOT NULL
             AND status = 'active'`,
        [rent.property_id, rent.tenant_id],
      );

    return plans.map((p) => ({
      id: `renewal_payment_plan_drift:${p.id}`,
      severity: 'blocker' as const,
      kind: 'payment_plan_drift' as const,
      description:
        `Active renewal payment plan "${p.charge_name}" was built from the previous period. ` +
        `Installment due dates won't move automatically — acknowledge to record the desync, ` +
        `then void/refund via the payment-plan flow if you want a clean reset.`,
      suggestedFix: {
        label: 'Acknowledge desync',
        action: 'acknowledge_only' as const,
      },
    }));
  }

  /**
   * Per D2: outstanding-balance payment plans (charge-scope, carrying the
   * 'outstanding_balance' externalId) are warnings — OB amounts are
   * auto-recomputed from the post-reconciliation wallet on commit, so there
   * is nothing for the user to do beyond acknowledge the shift.
   *
   * Renewal commit path doesn't run wallet reconciliation or plan recompute,
   * so the "recompute on commit" promise doesn't apply there.
   */
  private async detectOBPaymentPlanShift(
    rent: Rent,
    proposed: ProposedRentChange,
    context: PreviewContext,
  ): Promise<RentChangeIssueDto[]> {
    if (context === 'invoice_edit' || context === 'renewal') return [];

    const plans: Array<{ id: string; charge_name: string; total_amount: string }> =
      await this.dataSource.query(
        `SELECT id, charge_name, total_amount FROM payment_plans
           WHERE property_id = $1 AND tenant_id = $2
             AND scope = 'charge'
             AND charge_fee_kind = 'other'
             AND charge_external_id = 'outstanding_balance'
             AND status = 'active'`,
        [rent.property_id, rent.tenant_id],
      );

    return plans.map((p) => ({
      id: `ob_payment_plan_shift:${p.id}`,
      severity: 'warning' as const,
      kind: 'payment_plan_drift' as const,
      description:
        `Outstanding-balance payment plan "${p.charge_name}" (₦${Number(p.total_amount).toLocaleString('en-NG')}) ` +
        `will be recomputed against the tenant's post-reconciliation wallet balance. No manual action required.`,
      suggestedFix: {
        label: 'Acknowledge — recompute on commit',
        action: 'acknowledge_only' as const,
      },
    }));
  }

  /**
   * Per D2: charge-scope plans for specific fees (not OB) are listed for
   * visibility only — unless the specific charge itself is being moved by
   * this edit, they're unaffected. No suggested fix, no blocker.
   */
  private async detectSpecificChargePlan(
    rent: Rent,
    proposed: ProposedRentChange,
    context: PreviewContext,
  ): Promise<RentChangeIssueDto[]> {
    if (context === 'invoice_edit') return [];

    const plans: Array<{ id: string; charge_name: string; charge_fee_kind: string | null }> =
      await this.dataSource.query(
        `SELECT id, charge_name, charge_fee_kind FROM payment_plans
           WHERE property_id = $1 AND tenant_id = $2
             AND scope = 'charge'
             AND NOT (charge_fee_kind = 'other' AND charge_external_id = 'outstanding_balance')
             AND status = 'active'`,
        [rent.property_id, rent.tenant_id],
      );

    return plans.map((p) => ({
      id: `specific_charge_plan:${p.id}`,
      severity: 'info' as const,
      kind: 'payment_plan_drift' as const,
      description:
        `Payment plan "${p.charge_name}" (${p.charge_fee_kind ?? 'charge'}) is active. ` +
        `It's unaffected unless you're also editing that specific charge.`,
      suggestedFix: null,
    }));
  }

  /**
   * Feeds the "Schedule extends past tenancy period" chip — emits an info
   * issue for every active plan whose latest installment due_date falls
   * beyond the proposed tenancy expiry. Chip is read-side only until
   * editable payment plans ship.
   */
  private async detectPaymentPlanExtendsBeyondPeriod(
    rent: Rent,
    proposed: ProposedRentChange,
    context: PreviewContext,
  ): Promise<RentChangeIssueDto[]> {
    if (context === 'invoice_edit') return [];

    const rows: Array<{ id: string; charge_name: string; max_due: string }> =
      await this.dataSource.query(
        `SELECT p.id, p.charge_name, MAX(i.due_date) AS max_due
           FROM payment_plans p
           INNER JOIN payment_plan_installments i ON i.plan_id = p.id
           WHERE p.property_id = $1 AND p.tenant_id = $2
             AND p.status = 'active'
           GROUP BY p.id, p.charge_name
           HAVING MAX(i.due_date) > $3`,
        [rent.property_id, rent.tenant_id, proposed.expiryDate],
      );

    return rows.map((r) => ({
      id: `payment_plan_extends_beyond:${r.id}`,
      severity: 'info' as const,
      kind: 'payment_plan_drift' as const,
      description:
        `Payment plan "${r.charge_name}" has installments scheduled up to ${toISODate(new Date(r.max_due))}, ` +
        `beyond the proposed tenancy end ${toISODate(proposed.expiryDate)}. ` +
        `A "Schedule extends past tenancy period" chip will remain on the plan until it's revised.`,
      suggestedFix: null,
    }));
  }
}

// ---------------------------------------------------------------------------
// Local helpers & types used by the preview path
// ---------------------------------------------------------------------------

type PreviewContext = 'active_rent' | 'renewal' | 'invoice_edit';

interface ProposedRentChange {
  rentAmount: number;
  paymentFrequency: string;
  rentStartDate: Date;
  expiryDate: Date;
}

// Structural types matching the DTO shapes but decoupled so service callers
// from other places (e.g. the mutation paths re-running preview) don't have
// to import the Nest DTO class.
interface UpdateRenewalInvoiceDtoLike {
  rentAmount: number;
  paymentFrequency: string;
  endDate?: string;
  rentStartDate?: string;
  acknowledgedIssueIds?: string[];
}

interface InitiateRenewalDtoLike {
  rentAmount: number;
  paymentFrequency: string;
  startDate?: string;
  endDate?: string;
  acknowledgedIssueIds?: string[];
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface RentPeriodSnapshot {
  rent_start_date: Date | string | null | undefined;
  expiry_date: Date | string | null | undefined;
  payment_frequency: string | null | undefined;
  rental_price: number | string | null | undefined;
}

interface RecurringChange {
  label: string;
  before: boolean;
  after: boolean;
}

function computeRecurringChanges(oldFees: Fee[], newFees: Fee[]): RecurringChange[] {
  const changes: RecurringChange[] = [];
  // Match non-"other" fees by kind (one per kind); match "other" fees by
  // externalId (stable across edits). Rent is always recurring, so skip it.
  const keyOf = (f: Fee): string =>
    f.kind === 'other' ? `other:${f.externalId ?? ''}` : f.kind;
  const newByKey = new Map<string, Fee>();
  for (const nf of newFees) newByKey.set(keyOf(nf), nf);
  for (const of of oldFees) {
    if (of.kind === 'rent') continue;
    const nf = newByKey.get(keyOf(of));
    if (nf && nf.recurring !== of.recurring) {
      changes.push({
        label: of.label,
        before: of.recurring,
        after: nf.recurring,
      });
    }
  }
  return changes;
}

function datesEqual(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  return da.getTime() === db.getTime();
}

function rentPeriodAmendedDescription(
  before: RentPeriodSnapshot,
  after: RentPeriodSnapshot,
  recurringChanges: RecurringChange[] = [],
): string {
  const parts: string[] = [];
  if (!datesEqual(before.rent_start_date, after.rent_start_date)) {
    parts.push(
      `start ${toDateStrOrDash(before.rent_start_date)} → ${toDateStrOrDash(after.rent_start_date)}`,
    );
  }
  if (!datesEqual(before.expiry_date, after.expiry_date)) {
    parts.push(
      `expiry ${toDateStrOrDash(before.expiry_date)} → ${toDateStrOrDash(after.expiry_date)}`,
    );
  }
  if (before.payment_frequency !== after.payment_frequency) {
    parts.push(
      `frequency ${before.payment_frequency ?? '—'} → ${after.payment_frequency ?? '—'}`,
    );
  }
  const madeRecurring = recurringChanges.filter((c) => c.after).map((c) => c.label);
  const madeOneTime = recurringChanges.filter((c) => !c.after).map((c) => c.label);
  if (madeRecurring.length > 0) {
    parts.push(`${madeRecurring.join(', ')} made recurring`);
  }
  if (madeOneTime.length > 0) {
    parts.push(`${madeOneTime.join(', ')} made one-time`);
  }
  return `Tenancy period amended: ${parts.join('; ') || 'no field changes'}`;
}

function toDateStrOrDash(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  return toISODate(date);
}
