import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { isInvoiceFeeChargePlan as classifyInvoiceFeeChargePlan } from '../common/billing/plan-classification';
import {
  PaymentPlan,
  PaymentPlanScope,
  PaymentPlanSourceType,
  PaymentPlanStatus,
} from './entities/payment-plan.entity';
import {
  InstallmentPaymentMethod,
  InstallmentStatus,
  PaymentPlanInstallment,
} from './entities/payment-plan-installment.entity';
import {
  PaymentPlanSource,
  PaymentPlanSourceKind,
} from './entities/payment-plan-source.entity';
import { PaymentPlanAllocation } from './entities/payment-plan-allocation.entity';
import {
  AdHocInvoice,
  AdHocInvoiceStatus,
} from '../ad-hoc-invoices/entities/ad-hoc-invoice.entity';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
import { UpdatePaymentPlanDto } from './dto/update-payment-plan.dto';
import { MarkInstallmentPaidDto } from './dto/mark-installment-paid.dto';

import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';
import { PaystackService } from '../payments/paystack.service';
import { TenanciesService } from '../tenancies/tenancies.service';
import { RenewalChargeService } from '../renewal-letters/renewal-charge.service';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { Fee, FeeKind } from '../common/billing/fees';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../utils/utility-service';
import { PaymentPlanRequestsService } from './payment-plan-requests.service';

export interface PlanPaymentInitializationResult {
  accessCode: string;
  reference: string;
  authorizationUrl: string;
}

@Injectable()
export class PaymentPlansService {
  private readonly logger = new Logger(PaymentPlansService.name);

  constructor(
    @InjectRepository(PaymentPlan)
    private readonly planRepository: Repository<PaymentPlan>,
    @InjectRepository(PaymentPlanInstallment)
    private readonly installmentRepository: Repository<PaymentPlanInstallment>,
    @InjectRepository(PaymentPlanSource)
    private readonly sourceRepository: Repository<PaymentPlanSource>,
    @InjectRepository(PaymentPlanAllocation)
    private readonly allocationRepository: Repository<PaymentPlanAllocation>,
    @InjectRepository(AdHocInvoice)
    private readonly adHocInvoiceRepository: Repository<AdHocInvoice>,
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    private readonly paystackService: PaystackService,
    private readonly tenanciesService: TenanciesService,
    private readonly renewalChargeService: RenewalChargeService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly utilService: UtilService,
    private readonly requestsService: PaymentPlanRequestsService,
  ) {}

  /**
   * Is this a charge-scope plan that targets a *current-period invoice fee*
   * (rent, service charge, a named "other" fee, …)?
   *
   * Such a plan carves its fee out of the renewal invoice's `fee_breakdown` at
   * creation (`subtractChargeFromInvoice`), which already reduces the invoice
   * total. Crediting the tenant wallet per installment would then reduce the
   * invoice a SECOND time via `refreshInvoiceTotals` (total = sumAll(breakdown)
   * − wallet) — the verified "phantom credit" double-reduction. So these plans
   * must NOT credit the wallet; their installment rows are the record of
   * collection, and the carve at creation is the only invoice adjustment.
   *
   * The synthetic "Outstanding Balance" charge (charge_external_id ===
   * 'outstanding_balance') is the opposite: it settles real wallet-backed debt,
   * so it MUST credit the wallet. Tenancy-scope plans settle the whole invoice
   * via the ripple path and are unaffected by this predicate.
   *
   * Now keyed off the durable `source_type` discriminator, with the legacy
   * `charge_external_id === 'outstanding_balance'` / `ad_hoc_invoice_id` checks
   * retained so in-flight plans written before `source_type` existed still
   * classify correctly.
   */
  private isInvoiceFeeChargePlan(plan: PaymentPlan): boolean {
    // Single source of truth lives in common/billing so the landlord balance
    // breakdowns classify carved plans identically (see doc-comment above).
    return classifyInvoiceFeeChargePlan(plan);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Create
  // ───────────────────────────────────────────────────────────────────────

  async createPlan(
    dto: CreatePaymentPlanDto,
    createdByUserId?: string,
  ): Promise<PaymentPlan> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: dto.propertyTenantId },
      relations: ['property', 'tenant', 'tenant.user'],
    });
    if (!propertyTenant) {
      throw new NotFoundException('Tenancy not found');
    }

    if (dto.installments.length < 1) {
      throw new BadRequestException('Plan must have at least one installment');
    }
    const totalAmount = dto.installments.reduce(
      (sum, inst) => sum + Number(inst.amount),
      0,
    );
    if (totalAmount <= 0) {
      throw new BadRequestException('Total amount must be greater than zero');
    }

    // Ad-hoc-invoice plan (wallet-backed, Type B): settles a single ad-hoc
    // invoice, not a renewal-invoice fee. Bypasses the renewal-invoice
    // requirement entirely — this is the path for a tenant whose only debt is
    // an ad-hoc invoice (no unpaid renewal invoice exists).
    if (dto.adHocInvoiceId) {
      return this.createAdHocInvoicePlan(
        dto,
        propertyTenant,
        totalAmount,
        createdByUserId,
      );
    }

    // Outstanding-Balance plan (wallet-backed, Type B): settles the tenant's
    // net wallet debt — its uncovered ad-hoc invoices plus an arrears remainder
    // — NOT a renewal-invoice column. Like the ad-hoc path it needs no renewal
    // invoice, and it is net-of-coverage (debt already claimed by other active
    // wallet-backed plans is excluded), so it can never double-plan.
    //
    // Routed on the NAME *and* a positive Type-B signal: the picker's synthetic
    // OB row is the only producer of `expectedOutstandingBalance`. Requiring it
    // stops a real renewal-invoice "other" fee a landlord happened to name
    // "Outstanding Balance" from mis-routing here (it would carry no such field)
    // — that falls through to the renewal-invoice fee path below.
    if (
      dto.scope === PaymentPlanScope.CHARGE &&
      dto.chargeName?.trim().toLowerCase() === 'outstanding balance' &&
      dto.expectedOutstandingBalance != null
    ) {
      return this.createOutstandingBalancePlan(
        dto,
        propertyTenant,
        totalAmount,
        createdByUserId,
      );
    }

    // Locate the target renewal invoice — the current unpaid landlord
    // invoice for this tenancy. Either we were handed an id explicitly,
    // or we look up the latest unpaid non-superseded one. Superseded rows
    // (old letter versions replaced by a newer letter) must not be picked.
    const invoice = dto.renewalInvoiceId
      ? await this.renewalInvoiceRepository.findOne({
          where: { id: dto.renewalInvoiceId },
        })
      : await this.renewalInvoiceRepository.findOne({
          where: {
            property_tenant_id: dto.propertyTenantId,
            payment_status: RenewalPaymentStatus.UNPAID,
            token_type: 'landlord',
            superseded_by_id: IsNull(),
          },
          order: { created_at: 'DESC' },
        });

    if (!invoice) {
      throw new BadRequestException(
        'No unpaid renewal invoice found for this tenancy',
      );
    }
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      throw new ConflictException(
        'Cannot create a payment plan for an invoice that is already paid',
      );
    }

    // Heal any stale `total_amount` / `wallet_balance` against the current
    // ledger before we validate installments. Invoices snapshot the wallet
    // at creation; ledger entries written after that snapshot would otherwise
    // make a correct plan fail the sum check.
    await this.tenanciesService.refreshInvoiceTotals(
      invoice.tenant_id,
      propertyTenant.property.owner_id,
    );
    const refreshed = await this.renewalInvoiceRepository.findOne({
      where: { id: invoice.id },
    });
    if (refreshed) {
      invoice.total_amount = refreshed.total_amount;
      invoice.wallet_balance = refreshed.wallet_balance;
      invoice.outstanding_balance = refreshed.outstanding_balance;
    }

    // Resolve the charge kind for charge-scope plans from the invoice's
    // fee_breakdown. For tenancy-scope, there's no single fee to target.
    let chargeFeeKind: FeeKind | null = null;
    let chargeExternalId: string | null = null;
    let chargeAmount = totalAmount;
    let chargeName = dto.chargeName;

    if (dto.scope === PaymentPlanScope.CHARGE) {
      const breakdown = Array.isArray(invoice.fee_breakdown)
        ? invoice.fee_breakdown
        : [];
      const fee = breakdown.find(
        (f) => f.label?.toLowerCase() === dto.chargeName.toLowerCase(),
      );
      if (fee) {
        chargeFeeKind = fee.kind;
        chargeExternalId = fee.externalId ?? null;
        chargeAmount = Number(fee.amount);
        chargeName = fee.label;
      } else {
        // Note: an "Outstanding Balance" charge no longer reaches here — it is
        // routed to createOutstandingBalancePlan above (wallet-backed, needs no
        // renewal invoice). This branch is now only real renewal-invoice fees.
        throw new BadRequestException(
          `Charge "${dto.chargeName}" not found on the current renewal invoice`,
        );
      }

      // Validate: installments must sum to the exact charge amount.
      if (Math.abs(totalAmount - chargeAmount) > 1) {
        throw new BadRequestException(
          `Installments (₦${totalAmount.toLocaleString()}) must equal the charge amount (₦${chargeAmount.toLocaleString()})`,
        );
      }

      // Prevent duplicate active plans for the same charge on this invoice.
      const existing = await this.planRepository.findOne({
        where: {
          renewal_invoice_id: invoice.id,
          charge_name: chargeName,
          status: PaymentPlanStatus.ACTIVE,
        },
      });
      if (existing) {
        throw new ConflictException(
          `An active plan for ${chargeName} already exists on this invoice`,
        );
      }
    } else {
      // Tenancy scope — installments should sum to the invoice total.
      const invoiceTotal = Number(invoice.total_amount);
      if (Math.abs(totalAmount - invoiceTotal) > 1) {
        throw new BadRequestException(
          `Installments (₦${totalAmount.toLocaleString()}) must equal the invoice total (₦${invoiceTotal.toLocaleString()})`,
        );
      }
      const existing = await this.planRepository.findOne({
        where: {
          renewal_invoice_id: invoice.id,
          scope: PaymentPlanScope.TENANCY,
          status: PaymentPlanStatus.ACTIVE,
        },
      });
      if (existing) {
        throw new ConflictException(
          'An active tenancy-wide payment plan already exists on this invoice',
        );
      }
      chargeName = 'Entire Tenancy';
    }

    // Transactional: mutate the invoice's breakdown (charge scope only)
    // and insert the plan + installments.
    const saved = await this.dataSource.transaction(async (manager) => {
      if (dto.scope === PaymentPlanScope.CHARGE) {
        await this.subtractChargeFromInvoice(
          manager,
          invoice.id,
          chargeFeeKind!,
          chargeExternalId,
          chargeName,
          chargeAmount,
        );
      }

      const plan = manager.create(PaymentPlan, {
        property_tenant_id: propertyTenant.id,
        property_id: propertyTenant.property_id,
        tenant_id: propertyTenant.tenant_id,
        renewal_invoice_id: invoice.id,
        scope: dto.scope,
        charge_name: chargeName,
        charge_fee_kind: chargeFeeKind,
        charge_external_id: chargeExternalId,
        // Only real renewal-invoice fees + tenancy plans reach here now
        // (Outstanding Balance routes to its own wallet-backed path), so these
        // are always Type A.
        source_type: PaymentPlanSourceType.RENEWAL_INVOICE_FEE,
        total_amount: totalAmount,
        plan_type: dto.planType,
        status: PaymentPlanStatus.ACTIVE,
        created_by_user_id: createdByUserId ?? null,
      });
      const savedPlan = await manager.save(plan);

      const installments = dto.installments.map((inst, idx) =>
        manager.create(PaymentPlanInstallment, {
          plan_id: savedPlan.id,
          sequence: idx + 1,
          amount: Number(inst.amount),
          due_date: new Date(inst.dueDate),
          status: InstallmentStatus.PENDING,
        }),
      );
      await manager.save(installments);

      savedPlan.installments = installments;
      return savedPlan;
    });

    await this.logPlanEvent(
      'payment_plan_created',
      `Payment plan created — ${chargeName} — ₦${totalAmount.toLocaleString()} across ${dto.installments.length} installments`,
      saved,
      NotificationType.PAYMENT_PLAN_CREATED,
    );

    // If this plan came from a tenant-submitted request, atomically flip the
    // request to `approved` and link it. Done after the plan transaction so
    // we never leave an `approved` request without a plan; if this fails the
    // request stays `pending` and the landlord can retry.
    if (dto.fromRequestId && createdByUserId) {
      try {
        await this.requestsService.markApproved(
          dto.fromRequestId,
          saved.id,
          createdByUserId,
        );
      } catch (err) {
        this.logger.warn(
          `Plan ${saved.id} created but failed to mark request ${dto.fromRequestId} approved: ${(err as Error).message}`,
        );
      }
    }

    const fullPlan = await this.getPlan(saved.id);
    await this.dispatchPlanCreatedNotifications(fullPlan);
    return fullPlan;
  }

  /**
   * Create a wallet-backed plan that settles a single ad-hoc invoice.
   *
   * Unlike a renewal-invoice charge plan, this needs no unpaid renewal invoice
   * and carves nothing out of `fee_breakdown` — the ad-hoc's debt already lives
   * in the tenant wallet (debited at ad-hoc creation). The plan snapshots the
   * invoice as its sole FIFO source and stamps `covered_by_plan_id` so the
   * in-the-wild public pay link is locked while the plan is in force.
   *
   * Concurrency: the ad-hoc row is locked FOR UPDATE and `covered_by_plan_id`
   * re-checked IS NULL inside the transaction, so two simultaneous creates can
   * never both claim the same invoice.
   */
  private async createAdHocInvoicePlan(
    dto: CreatePaymentPlanDto,
    propertyTenant: PropertyTenant,
    totalAmount: number,
    createdByUserId?: string,
  ): Promise<PaymentPlan> {
    const adHocId = dto.adHocInvoiceId!;

    const preview = await this.adHocInvoiceRepository.findOne({
      where: { id: adHocId },
    });
    if (!preview) {
      throw new NotFoundException('Ad-hoc invoice not found');
    }
    if (preview.property_tenant_id !== dto.propertyTenantId) {
      throw new BadRequestException(
        'Ad-hoc invoice does not belong to this tenancy',
      );
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      // Lock the row so a concurrent create can't also claim this invoice.
      const invoice = await manager.findOne(AdHocInvoice, {
        where: { id: adHocId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) {
        throw new NotFoundException('Ad-hoc invoice not found');
      }
      if (invoice.status === AdHocInvoiceStatus.PAID) {
        throw new ConflictException(
          'This invoice is already paid — no payment plan needed',
        );
      }
      if (invoice.status === AdHocInvoiceStatus.CANCELLED) {
        throw new ConflictException(
          'This invoice has been cancelled and cannot have a payment plan',
        );
      }
      if (invoice.covered_by_plan_id) {
        throw new ConflictException(
          'This invoice is already covered by an active payment plan',
        );
      }

      const outstanding =
        Number(invoice.total_amount) - Number(invoice.amount_paid ?? 0);
      if (outstanding <= 0) {
        throw new ConflictException(
          'This invoice has no outstanding amount to plan',
        );
      }
      // Drift guard: the picker split the outstanding it read at page load.
      if (Math.abs(totalAmount - outstanding) > 1) {
        throw new ConflictException(
          'The invoice amount changed since you opened this form. Please reopen the payment plan and try again.',
        );
      }

      const chargeName = (
        dto.chargeName?.trim() || `Invoice ${invoice.invoice_number}`
      ).substring(0, 255);

      const plan = manager.create(PaymentPlan, {
        property_tenant_id: propertyTenant.id,
        property_id: propertyTenant.property_id,
        tenant_id: propertyTenant.tenant_id,
        renewal_invoice_id: null,
        scope: PaymentPlanScope.CHARGE,
        charge_name: chargeName,
        charge_fee_kind: null,
        charge_external_id: null,
        source_type: PaymentPlanSourceType.AD_HOC_INVOICE,
        ad_hoc_invoice_id: invoice.id,
        total_amount: totalAmount,
        plan_type: dto.planType,
        status: PaymentPlanStatus.ACTIVE,
        created_by_user_id: createdByUserId ?? null,
      });
      const savedPlan = await manager.save(plan);

      const installments = dto.installments.map((inst, idx) =>
        manager.create(PaymentPlanInstallment, {
          plan_id: savedPlan.id,
          sequence: idx + 1,
          amount: Number(inst.amount),
          due_date: new Date(inst.dueDate),
          status: InstallmentStatus.PENDING,
        }),
      );
      await manager.save(installments);

      // Freeze the single FIFO source (residual is derived from allocations).
      await manager.save(
        manager.create(PaymentPlanSource, {
          plan_id: savedPlan.id,
          source_kind: PaymentPlanSourceKind.AD_HOC_INVOICE,
          source_ad_hoc_invoice_id: invoice.id,
          arrears_bucket_key: null,
          covered_amount: outstanding,
          due_seq: 0,
        }),
      );

      // Stamp coverage with an IS NULL re-check (belt-and-suspenders vs the lock).
      const stamp = await manager.update(
        AdHocInvoice,
        { id: invoice.id, covered_by_plan_id: IsNull() },
        { covered_by_plan_id: savedPlan.id },
      );
      if (!stamp.affected) {
        throw new ConflictException(
          'This invoice is already covered by an active payment plan',
        );
      }

      savedPlan.installments = installments;
      return savedPlan;
    });

    // Re-fold any unpaid renewal invoice now that this plan owns this ad-hoc's
    // wallet debt, so the renewal stops collecting it (the plan collects it).
    // Non-blocking — the plan is already committed.
    try {
      await this.tenanciesService.refreshInvoiceTotals(
        propertyTenant.tenant_id,
        propertyTenant.property.owner_id,
      );
    } catch (err) {
      this.logger.warn(
        `Post-create renewal re-fold failed for plan ${saved.id}: ${(err as Error)?.message}`,
      );
    }

    await this.logPlanEvent(
      'payment_plan_created',
      `Payment plan created — ${saved.charge_name} — ₦${totalAmount.toLocaleString()} across ${dto.installments.length} installments`,
      saved,
      NotificationType.PAYMENT_PLAN_CREATED,
    );

    if (dto.fromRequestId && createdByUserId) {
      try {
        await this.requestsService.markApproved(
          dto.fromRequestId,
          saved.id,
          createdByUserId,
        );
      } catch (err) {
        this.logger.warn(
          `Plan ${saved.id} created but failed to mark request ${dto.fromRequestId} approved: ${(err as Error).message}`,
        );
      }
    }

    const fullPlan = await this.getPlan(saved.id);
    await this.dispatchPlanCreatedNotifications(fullPlan);
    return fullPlan;
  }

  private async dispatchPlanCreatedNotifications(
    plan: PaymentPlan,
  ): Promise<void> {
    try {
      const tenantUser = plan.tenant?.user;
      const tenantPhone = tenantUser?.phone_number
        ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
        : null;
      if (!tenantPhone) return;

      const property = plan.property;
      const propertyName = property?.name ?? 'your property';
      const tenantName =
        `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
        'there';

      const installments = [...(plan.installments ?? [])].sort(
        (a, b) => a.sequence - b.sequence,
      );
      const firstInstallment = installments[0];
      if (!firstInstallment) return;

      // Tenant-facing label: "Tenancy" reads better than the stored
      // "Entire Tenancy" sentinel for tenancy-scope plans.
      const displayChargeName =
        plan.scope === PaymentPlanScope.TENANCY ? 'Tenancy' : plan.charge_name;

      await this.whatsappNotificationLog.queue(
        'sendPaymentPlanCreatedTenant',
        {
          phone_number: tenantPhone,
          tenant_name: tenantName,
          charge_name: displayChargeName,
          property_name: propertyName,
          total_amount: Number(plan.total_amount),
          installments_summary: String(installments.length),
          first_installment_id: firstInstallment.id,
          landlord_id: property?.owner_id,
          property_id: property?.id,
          recipient_name: tenantName,
        },
        plan.id,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to queue plan-created WhatsApp notification for plan ${plan.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The slice of wallet-backed debt a NEW Outstanding-Balance plan may cover:
   * the net wallet OB minus
   *   (a) the unpaid remainder of every active wallet-backed plan (so coverage
   *       already claimed by an ad-hoc/OB plan is never re-planned), and
   *   (b) the CURRENT pending renewal period — once a renewal letter is accepted
   *       its period rent/service are debited to the wallet as a
   *       `letter_accepted_charge`, so the raw wallet OB would otherwise include
   *       a period that belongs to the renewal-invoice / tenancy plan path. An OB
   *       plan must cover only GENUINE prior arrears, or the same period gets
   *       planned twice (OB plan + renewal invoice). Mirrors computeRenewalFold's
   *       own-letter add-back and the frontend foldedPriorDebt helper.
   * Reads the wallet scalar + the ledger — never a renewal-invoice total column.
   */
  private async computePlannableOb(
    tenantId: string,
    landlordId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const balance = await this.tenantBalancesService.getBalance(
      tenantId,
      landlordId,
    );
    const walletOb = balance < 0 ? -balance : 0;

    // Own-period charge: Σ of the unreversed letter_accepted_charge magnitudes
    // across this tenant's pending unpaid landlord renewal invoices under THIS
    // landlord. Each is the period already itemized on its own invoice, so it is
    // not prior arrears. Additive across tenancies (the wallet is shared by
    // (tenant, landlord)); a not-yet-accepted invoice contributes 0.
    const invoiceRepo = manager
      ? manager.getRepository(RenewalInvoice)
      : this.renewalInvoiceRepository;
    const pendingInvoices = await invoiceRepo
      .createQueryBuilder('ri')
      .innerJoin(Property, 'p', 'p.id = ri.property_id')
      .where('ri.tenant_id = :tenantId', { tenantId })
      .andWhere('p.owner_id = :landlordId', { landlordId })
      .andWhere('ri.payment_status = :unpaid', {
        unpaid: RenewalPaymentStatus.UNPAID,
      })
      .andWhere("ri.token_type = 'landlord'")
      .andWhere('ri.superseded_by_id IS NULL')
      .andWhere('ri.deleted_at IS NULL')
      .select('ri.id', 'id')
      .getRawMany<{ id: string }>();
    let ownPeriod = 0;
    for (const inv of pendingInvoices) {
      ownPeriod += await this.renewalChargeService.getLetterAcceptedChargeAmount(
        inv.id,
        manager,
      );
    }
    // Net the own period before the plan-claim subtraction, matching the fold
    // (foldedDebt = wallet + ownLetterCharge, then minus claimed).
    const priorWalletOb = Math.max(0, walletOb - ownPeriod);

    // The wallet is keyed (tenant, landlord), shared across every tenancy that
    // tenant holds under this landlord. So the claimed term must subtract the
    // remainder of ALL the tenant's active wallet-backed plans under this
    // landlord — not just this one tenancy's — or the same wallet debt could be
    // double-planned across two units. Scope by tenant_id + property.owner_id.
    const planRepo = manager
      ? manager.getRepository(PaymentPlan)
      : this.planRepository;
    const activePlans = await planRepo.find({
      where: {
        tenant_id: tenantId,
        status: PaymentPlanStatus.ACTIVE,
        source_type: In([
          PaymentPlanSourceType.OUTSTANDING_BALANCE,
          PaymentPlanSourceType.AD_HOC_INVOICE,
        ]),
      },
      relations: ['installments', 'property'],
    });
    let claimed = 0;
    for (const p of activePlans) {
      if (p.property?.owner_id !== landlordId) continue;
      const paid = (p.installments ?? [])
        .filter((i) => i.status === InstallmentStatus.PAID)
        .reduce((s, i) => s + Number(i.amount_paid ?? i.amount), 0);
      claimed += Math.max(0, Number(p.total_amount) - paid);
    }
    return Math.max(0, priorWalletOb - claimed);
  }

  /**
   * Build the frozen FIFO source list for an Outstanding-Balance plan: every
   * uncovered ad-hoc invoice (oldest due first, locked FOR UPDATE) up to the
   * plannable amount, plus an "arrears" remainder bucket for wallet debt not
   * attributable to a specific ad-hoc (swept rent, migration, …).
   */
  private async enumerateWalletBackedSources(
    manager: EntityManager,
    propertyTenant: PropertyTenant,
    landlordId: string,
  ): Promise<{
    sources: Array<{
      source_kind: PaymentPlanSourceKind;
      source_ad_hoc_invoice_id: string | null;
      arrears_bucket_key: string | null;
      covered_amount: number;
    }>;
    adHocIds: string[];
    plannable: number;
  }> {
    const plannable = await this.computePlannableOb(
      propertyTenant.tenant_id,
      landlordId,
      manager,
    );

    const adHocs = await manager.find(AdHocInvoice, {
      where: {
        property_tenant_id: propertyTenant.id,
        covered_by_plan_id: IsNull(),
        status: In([AdHocInvoiceStatus.PENDING, AdHocInvoiceStatus.PARTIAL]),
      },
      order: { due_date: 'ASC', created_at: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    const sources: Array<{
      source_kind: PaymentPlanSourceKind;
      source_ad_hoc_invoice_id: string | null;
      arrears_bucket_key: string | null;
      covered_amount: number;
    }> = [];
    const adHocIds: string[] = [];
    let allocated = 0;
    for (const inv of adHocs) {
      const outstanding =
        Number(inv.total_amount) - Number(inv.amount_paid ?? 0);
      if (outstanding <= 0.5) continue;
      const cover = Math.min(outstanding, plannable - allocated);
      if (cover <= 0.5) break;
      sources.push({
        source_kind: PaymentPlanSourceKind.AD_HOC_INVOICE,
        source_ad_hoc_invoice_id: inv.id,
        arrears_bucket_key: null,
        covered_amount: cover,
      });
      adHocIds.push(inv.id);
      allocated += cover;
    }

    const arrears = plannable - allocated;
    if (arrears > 0.5) {
      sources.push({
        source_kind: PaymentPlanSourceKind.ARREARS,
        source_ad_hoc_invoice_id: null,
        arrears_bucket_key: `arrears:${propertyTenant.property_id}`,
        covered_amount: arrears,
      });
    }

    return { sources, adHocIds, plannable };
  }

  /**
   * Create a wallet-backed Outstanding-Balance plan. Needs no renewal invoice
   * and carves nothing: it snapshots the tenant's net wallet debt (uncovered
   * ad-hocs + arrears) as FIFO sources, stamps coverage on the ad-hocs, and is
   * net-of-coverage so it can never double-plan debt an existing plan owns.
   */
  private async createOutstandingBalancePlan(
    dto: CreatePaymentPlanDto,
    propertyTenant: PropertyTenant,
    totalAmount: number,
    createdByUserId?: string,
  ): Promise<PaymentPlan> {
    const landlordId = propertyTenant.property.owner_id;
    const tenantId = propertyTenant.tenant_id;

    // Heal wallet-derived totals first (mirrors the legacy OB path).
    await this.tenanciesService.refreshInvoiceTotals(tenantId, landlordId);

    const plannableOb = await this.computePlannableOb(tenantId, landlordId);
    if (plannableOb <= 0) {
      throw new ConflictException(
        'There is no outstanding balance left to plan — it may already be covered by an active payment plan.',
      );
    }
    if (
      dto.expectedOutstandingBalance != null &&
      Math.abs(dto.expectedOutstandingBalance - plannableOb) > 1
    ) {
      throw new ConflictException(
        'The outstanding balance changed since you opened this form. Please reopen the payment plan and try again.',
      );
    }
    if (Math.abs(totalAmount - plannableOb) > 1) {
      throw new BadRequestException(
        `Installments (₦${totalAmount.toLocaleString()}) must equal the outstanding balance (₦${plannableOb.toLocaleString()})`,
      );
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      // Serialize concurrent OB-plan creates for this tenant. The arrears bucket
      // has no row to lock FOR UPDATE, so without this two creates could both
      // claim it. The advisory lock is released at transaction end.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `ppob:${tenantId}`,
      ]);

      const { sources, adHocIds, plannable } =
        await this.enumerateWalletBackedSources(
          manager,
          propertyTenant,
          landlordId,
        );

      // Re-check the plannable amount didn't move under us (a concurrent plan
      // or a new charge between the pre-flight read and the lock).
      if (Math.abs(plannable - plannableOb) > 1) {
        throw new ConflictException(
          'The outstanding balance changed while creating the plan. Please reopen the payment plan and try again.',
        );
      }
      if (sources.length === 0) {
        throw new ConflictException(
          'There is no outstanding balance left to plan.',
        );
      }

      const plan = manager.create(PaymentPlan, {
        property_tenant_id: propertyTenant.id,
        property_id: propertyTenant.property_id,
        tenant_id: tenantId,
        renewal_invoice_id: null,
        scope: PaymentPlanScope.CHARGE,
        charge_name: 'Outstanding Balance',
        charge_fee_kind: null,
        // Keep the legacy marker so read paths that key on it still work.
        charge_external_id: 'outstanding_balance',
        source_type: PaymentPlanSourceType.OUTSTANDING_BALANCE,
        ad_hoc_invoice_id: null,
        total_amount: totalAmount,
        plan_type: dto.planType,
        status: PaymentPlanStatus.ACTIVE,
        created_by_user_id: createdByUserId ?? null,
      });
      const savedPlan = await manager.save(plan);

      const installments = dto.installments.map((inst, idx) =>
        manager.create(PaymentPlanInstallment, {
          plan_id: savedPlan.id,
          sequence: idx + 1,
          amount: Number(inst.amount),
          due_date: new Date(inst.dueDate),
          status: InstallmentStatus.PENDING,
        }),
      );
      await manager.save(installments);

      await manager.save(
        sources.map((s, idx) =>
          manager.create(PaymentPlanSource, {
            plan_id: savedPlan.id,
            source_kind: s.source_kind,
            source_ad_hoc_invoice_id: s.source_ad_hoc_invoice_id,
            arrears_bucket_key: s.arrears_bucket_key,
            covered_amount: s.covered_amount,
            due_seq: idx,
          }),
        ),
      );

      for (const adHocId of adHocIds) {
        const stamp = await manager.update(
          AdHocInvoice,
          { id: adHocId, covered_by_plan_id: IsNull() },
          { covered_by_plan_id: savedPlan.id },
        );
        if (!stamp.affected) {
          throw new ConflictException(
            'One of the invoices was just claimed by another plan. Please reopen the payment plan and try again.',
          );
        }
      }

      savedPlan.installments = installments;
      return savedPlan;
    });

    // Re-fold any unpaid renewal invoice now that this plan owns part of the
    // wallet OB, so the renewal stops collecting the planned slice (the plan
    // collects it). Plan creation doesn't move the wallet, so nothing else
    // triggers this refresh. Non-blocking: the plan is already committed — a
    // refresh hiccup must not fail the create (the next balance event re-folds).
    try {
      await this.tenanciesService.refreshInvoiceTotals(tenantId, landlordId);
    } catch (err) {
      this.logger.warn(
        `Post-create renewal re-fold failed for plan ${saved.id}: ${(err as Error)?.message}`,
      );
    }

    await this.logPlanEvent(
      'payment_plan_created',
      `Payment plan created — Outstanding Balance — ₦${totalAmount.toLocaleString()} across ${dto.installments.length} installments`,
      saved,
      NotificationType.PAYMENT_PLAN_CREATED,
    );

    if (dto.fromRequestId && createdByUserId) {
      try {
        await this.requestsService.markApproved(
          dto.fromRequestId,
          saved.id,
          createdByUserId,
        );
      } catch (err) {
        this.logger.warn(
          `Plan ${saved.id} created but failed to mark request ${dto.fromRequestId} approved: ${(err as Error).message}`,
        );
      }
    }

    const fullPlan = await this.getPlan(saved.id);
    await this.dispatchPlanCreatedNotifications(fullPlan);
    return fullPlan;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────────

  async listPlans(
    propertyTenantId?: string,
    tenantId?: string,
    propertyId?: string,
  ): Promise<PaymentPlan[]> {
    const qb = this.planRepository
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.installments', 'installments')
      .where('plan.status != :cancelledStatus', {
        cancelledStatus: PaymentPlanStatus.CANCELLED,
      })
      .orderBy('plan.created_at', 'DESC')
      .addOrderBy('installments.sequence', 'ASC');

    if (propertyTenantId) {
      qb.andWhere('plan.property_tenant_id = :propertyTenantId', {
        propertyTenantId,
      });
    }
    if (tenantId) {
      qb.andWhere('plan.tenant_id = :tenantId', { tenantId });
    }
    if (propertyId) {
      qb.andWhere('plan.property_id = :propertyId', { propertyId });
    }

    return qb.getMany();
  }

  async getPlan(id: string): Promise<PaymentPlan> {
    const plan = await this.planRepository.findOne({
      where: { id },
      relations: [
        'installments',
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
      order: {
        installments: { sequence: 'ASC' },
      },
    });
    if (!plan) {
      throw new NotFoundException('Payment plan not found');
    }
    return plan;
  }

  async getInstallment(id: string): Promise<PaymentPlanInstallment> {
    const installment = await this.installmentRepository.findOne({
      where: { id },
      relations: ['plan', 'plan.property', 'plan.tenant', 'plan.tenant.user'],
    });
    if (!installment) {
      throw new NotFoundException('Installment not found');
    }
    return installment;
  }

  /**
   * Public, token-less view of an installment — rendered at
   * /pay-installment/:id after the tenant clicks the WhatsApp button.
   * Includes the installment, sibling installments, plan, property,
   * tenant contact, and landlord branding.
   */
  async getPublicInstallmentView(installmentId: string): Promise<any> {
    const installment = await this.installmentRepository.findOne({
      where: { id: installmentId },
      relations: [
        'plan',
        'plan.property',
        'plan.property.owner',
        'plan.property.owner.user',
        'plan.tenant',
        'plan.tenant.user',
      ],
    });
    if (!installment) {
      throw new NotFoundException('Installment not found');
    }

    // Fetch all sibling installments so the pay page can show the
    // whole schedule in context.
    const siblings = await this.installmentRepository.find({
      where: { plan_id: installment.plan_id },
      order: { sequence: 'ASC' },
    });

    const plan = installment.plan;
    const property = plan.property;
    const landlordUser = property.owner?.user;
    const landlordBranding = landlordUser?.branding || null;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] || landlordBranding?.letterhead || null;

    const tenantUser = plan.tenant?.user;
    const tenantEmail =
      (plan.tenant as any)?.email ?? tenantUser?.email ?? null;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : '';

    const formatDate = (d: Date | string | null | undefined): string | null => {
      if (!d) return null;
      if (typeof d === 'string') return d.split('T')[0];
      return d.toISOString().split('T')[0];
    };

    const paidInstallments = siblings.filter(
      (s) => s.status === InstallmentStatus.PAID,
    );
    const amountPaidToDate = paidInstallments.reduce(
      (sum, s) => sum + Number(s.amount_paid ?? s.amount),
      0,
    );

    return {
      installment: {
        id: installment.id,
        sequence: installment.sequence,
        amount: Number(installment.amount),
        dueDate: formatDate(installment.due_date),
        status: installment.status,
        paidAt: installment.paid_at
          ? (installment.paid_at instanceof Date
              ? installment.paid_at.toISOString()
              : installment.paid_at)
          : null,
        amountPaid:
          installment.amount_paid != null
            ? Number(installment.amount_paid)
            : null,
        paymentMethod: installment.payment_method,
        paystackReference: installment.paystack_reference,
        manualPaymentNote: installment.manual_payment_note,
        receiptToken: installment.receipt_token,
        receiptNumber: installment.receipt_number,
      },
      plan: {
        id: plan.id,
        scope: plan.scope,
        chargeName: plan.charge_name,
        planType: plan.plan_type,
        status: plan.status,
        totalAmount: Number(plan.total_amount),
        totalInstallments: siblings.length,
        paidInstallments: paidInstallments.length,
        amountPaidToDate,
        amountRemaining: Math.max(
          0,
          Number(plan.total_amount) - amountPaidToDate,
        ),
        createdAt:
          plan.created_at instanceof Date
            ? plan.created_at.toISOString()
            : plan.created_at,
      },
      installments: siblings.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        amount: Number(s.amount),
        dueDate: formatDate(s.due_date),
        status: s.status,
        paidAt: s.paid_at
          ? (s.paid_at instanceof Date
              ? s.paid_at.toISOString()
              : s.paid_at)
          : null,
        amountPaid: s.amount_paid != null ? Number(s.amount_paid) : null,
        paymentMethod: s.payment_method,
      })),
      property: {
        id: property.id,
        name: property.name,
        address: property.location,
      },
      tenant: {
        name: tenantName,
        email: tenantEmail,
        phone: tenantUser?.phone_number ?? null,
      },
      landlordBranding,
      landlordLogoUrl,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Verify Paystack payment (tenant-facing, idempotent with webhook)
  // ───────────────────────────────────────────────────────────────────────

  async verifyInstallmentPayment(
    installmentId: string,
    reference: string,
  ): Promise<{
    status: 'success' | 'failed' | 'pending';
    reference: string;
    amount: number;
    paidAt: string | null;
    receiptToken: string | null;
  }> {
    const installment = await this.getInstallment(installmentId);

    const paystackResponse =
      await this.paystackService.verifyTransaction(reference);
    const data = paystackResponse.data;

    if (data.status !== 'success') {
      return {
        status: data.status === 'failed' ? 'failed' : 'pending',
        reference: data.reference,
        amount: data.amount / 100,
        paidAt: null,
        receiptToken: null,
      };
    }

    // Successful payment — mark paid if not already (webhook may have beaten us).
    if (installment.status !== InstallmentStatus.PAID) {
      try {
        await this.markInstallmentPaidFromWebhook({
          reference: data.reference,
          amount: data.amount,
          metadata: {
            payment_plan_installment_id: installmentId,
          },
        });
      } catch (err) {
        this.logger.error(
          `verifyInstallmentPayment failed to mark paid for ${installmentId}`,
          (err as Error).stack,
        );
      }
    }

    const fresh = await this.getInstallment(installmentId);
    return {
      status: 'success',
      reference: data.reference,
      amount: Number(fresh.amount_paid ?? fresh.amount),
      paidAt: fresh.paid_at
        ? fresh.paid_at instanceof Date
          ? fresh.paid_at.toISOString()
          : fresh.paid_at
        : null,
      receiptToken: fresh.receipt_token ?? null,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public: success-page data (after Paystack verify)
  // ───────────────────────────────────────────────────────────────────────

  async getInstallmentSuccessData(installmentId: string): Promise<{
    installmentId: string;
    receiptToken: string | null;
    receiptNumber: string | null;
    paidAt: string | null;
    paymentReference: string | null;
    installment: {
      sequence: number;
      amount: number;
      amountPaid: number | null;
    };
    plan: {
      id: string;
      chargeName: string;
      scope: PaymentPlanScope;
      totalInstallments: number;
      paidInstallments: number;
      status: PaymentPlanStatus;
    };
    property: { id: string; name: string };
    tenant: { name: string };
  }> {
    const installment = await this.installmentRepository.findOne({
      where: { id: installmentId },
      relations: ['plan', 'plan.property', 'plan.tenant', 'plan.tenant.user'],
    });
    if (!installment) {
      throw new NotFoundException('Installment not found');
    }
    if (installment.status !== InstallmentStatus.PAID) {
      throw new NotFoundException('Installment is not yet paid');
    }

    const siblings = await this.installmentRepository.find({
      where: { plan_id: installment.plan_id },
    });
    const paidCount = siblings.filter(
      (s) => s.status === InstallmentStatus.PAID,
    ).length;

    const tenantUser = installment.plan.tenant?.user;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : '';

    return {
      installmentId: installment.id,
      receiptToken: installment.receipt_token ?? null,
      receiptNumber: installment.receipt_number ?? null,
      paidAt: installment.paid_at
        ? installment.paid_at instanceof Date
          ? installment.paid_at.toISOString()
          : installment.paid_at
        : null,
      paymentReference: installment.paystack_reference ?? null,
      installment: {
        sequence: installment.sequence,
        amount: Number(installment.amount),
        amountPaid:
          installment.amount_paid != null
            ? Number(installment.amount_paid)
            : null,
      },
      plan: {
        id: installment.plan.id,
        chargeName: installment.plan.charge_name,
        scope: installment.plan.scope,
        totalInstallments: siblings.length,
        paidInstallments: paidCount,
        status: installment.plan.status,
      },
      property: {
        id: installment.plan.property.id,
        name: installment.plan.property.name,
      },
      tenant: { name: tenantName },
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public: receipt view by receipt_token
  // ───────────────────────────────────────────────────────────────────────

  async getInstallmentReceiptView(receiptToken: string): Promise<any> {
    const installment = await this.installmentRepository.findOne({
      where: { receipt_token: receiptToken },
      relations: [
        'plan',
        'plan.property',
        'plan.property.owner',
        'plan.property.owner.user',
        'plan.tenant',
        'plan.tenant.user',
      ],
    });
    if (!installment) {
      throw new NotFoundException('Receipt not found');
    }
    if (installment.status !== InstallmentStatus.PAID) {
      throw new NotFoundException('Receipt not available — payment required');
    }

    const plan = installment.plan;
    const property = plan.property;
    const landlordUser = property.owner?.user;
    const landlordBranding = landlordUser?.branding || null;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] || landlordBranding?.letterhead || null;

    const tenantUser = plan.tenant?.user;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : '';
    const tenantEmail =
      (plan.tenant as any)?.email ?? tenantUser?.email ?? null;

    const siblings = await this.installmentRepository.find({
      where: { plan_id: installment.plan_id },
      order: { sequence: 'ASC' },
    });
    const paidCount = siblings.filter(
      (s) => s.status === InstallmentStatus.PAID,
    ).length;

    return {
      receiptNumber: installment.receipt_number,
      receiptToken: installment.receipt_token,
      receiptDate: installment.paid_at
        ? installment.paid_at instanceof Date
          ? installment.paid_at.toISOString()
          : installment.paid_at
        : null,
      paymentReference: installment.paystack_reference ?? null,
      paymentMethod: installment.payment_method,
      manualPaymentNote: installment.manual_payment_note,
      amount: Number(installment.amount_paid ?? installment.amount),
      installment: {
        id: installment.id,
        sequence: installment.sequence,
        amount: Number(installment.amount),
        dueDate:
          installment.due_date instanceof Date
            ? installment.due_date.toISOString().split('T')[0]
            : installment.due_date,
      },
      plan: {
        id: plan.id,
        scope: plan.scope,
        chargeName: plan.charge_name,
        planType: plan.plan_type,
        status: plan.status,
        totalAmount: Number(plan.total_amount),
        totalInstallments: siblings.length,
        paidInstallments: paidCount,
      },
      property: {
        id: property.id,
        name: property.name,
        address: property.location,
      },
      tenant: {
        name: tenantName,
        email: tenantEmail,
        phone: tenantUser?.phone_number ?? null,
      },
      landlordBranding,
      landlordLogoUrl,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cancel
  // ───────────────────────────────────────────────────────────────────────

  async cancelPlan(id: string, cancelledByUserId?: string): Promise<void> {
    const plan = await this.getPlan(id);

    if (plan.status !== PaymentPlanStatus.ACTIVE) {
      throw new ConflictException('Plan is not active');
    }

    const paidInstallments = plan.installments.filter(
      (i) => i.status === InstallmentStatus.PAID,
    );
    const totalPaid = paidInstallments.reduce(
      (sum, i) => sum + Number(i.amount_paid ?? i.amount),
      0,
    );

    await this.dataSource.transaction(async (manager) => {
      // Charge-scope: restore the carved-out fee to the parent invoice.
      //  • Outstanding-Balance (wallet-backed) plans: paid installments live as
      //    wallet credit, so restore the FULL carved amount — restoring only the
      //    unpaid portion would double-credit the tenant.
      //  • Invoice-fee charge plans: paid installments do NOT credit the wallet
      //    (see isInvoiceFeeChargePlan); the paid portion was really collected
      //    via the plan, so restore ONLY the unpaid remainder — restoring the
      //    full amount would re-bill the tenant for what they already paid.
      // Tenancy-scope: installment payments already decremented the invoice
      // progressively, so the invoice is correctly stated — leave it alone.
      if (
        plan.scope === PaymentPlanScope.CHARGE &&
        plan.renewal_invoice_id &&
        plan.charge_fee_kind
      ) {
        const restoreAmount = this.isInvoiceFeeChargePlan(plan)
          ? Math.max(0, Number(plan.total_amount) - totalPaid)
          : Number(plan.total_amount);
        await this.restoreChargeToInvoice(
          manager,
          plan.renewal_invoice_id,
          plan.charge_fee_kind,
          plan.charge_external_id,
          plan.charge_name,
          restoreAmount,
        );
      }

      // Wallet-backed plans (single ad-hoc OR Outstanding Balance): re-open the
      // public pay link of every ad-hoc this plan owns by clearing coverage
      // (scoped to THIS plan so we never stomp a different owner). Money already
      // collected via paid installments stays as wallet credit — no clawback.
      //
      // Crucially we bake the plan's UN-collected claim into amount_paid before
      // re-opening, so the link only re-charges the residual CASH the plan would
      // still have collected — never the full face. A source's residual cash =
      // covered_amount − Σ(its allocations). The portion total − covered_amount
      // was funded by a wallet credit (partial coverage only arises with one),
      // so it is "already settled" and must not be re-billed. amount_paid =
      // total − residual leaves the link charging exactly `residual`.
      // Legacy synthetic-OB plans have no sources and fall through to the
      // restoreChargeToInvoice path above.
      const planSources = await manager.find(PaymentPlanSource, {
        where: { plan_id: plan.id },
      });
      for (const src of planSources) {
        if (
          src.source_kind !== PaymentPlanSourceKind.AD_HOC_INVOICE ||
          !src.source_ad_hoc_invoice_id
        ) {
          continue;
        }
        const invoice = await manager.findOne(AdHocInvoice, {
          where: { id: src.source_ad_hoc_invoice_id },
        });
        if (
          !invoice ||
          invoice.covered_by_plan_id !== plan.id ||
          invoice.status === AdHocInvoiceStatus.PAID ||
          invoice.status === AdHocInvoiceStatus.CANCELLED
        ) {
          // Already settled / re-claimed / closed — just clear our stamp if set.
          if (invoice && invoice.covered_by_plan_id === plan.id) {
            await manager.update(AdHocInvoice, invoice.id, {
              covered_by_plan_id: null,
            });
          }
          continue;
        }
        const allocRow = await manager
          .createQueryBuilder(PaymentPlanAllocation, 'a')
          .select('COALESCE(SUM(a.amount), 0)', 'sum')
          .where('a.source_id = :sid', { sid: src.id })
          .getRawOne<{ sum: string }>();
        const residual = Math.max(
          0,
          Number(src.covered_amount) - Number(allocRow?.sum ?? 0),
        );
        const total = Number(invoice.total_amount);
        const newAmountPaid = Math.max(0, Math.min(total, total - residual));
        const fullyPaid = newAmountPaid >= total - 1;
        await manager.update(AdHocInvoice, invoice.id, {
          covered_by_plan_id: null,
          amount_paid: newAmountPaid,
          status: fullyPaid
            ? AdHocInvoiceStatus.PAID
            : newAmountPaid > 0.5
              ? AdHocInvoiceStatus.PARTIAL
              : AdHocInvoiceStatus.PENDING,
        });
      }

      await manager.update(PaymentPlan, plan.id, {
        status: PaymentPlanStatus.CANCELLED,
      });
    });

    // Cancel any still-pending WhatsApp reminders for this plan's
    // installments so they don't fire after deletion.
    const installmentIds = plan.installments.map((i) => i.id);
    await this.whatsappNotificationLog
      .cancelPendingByReferenceIds(installmentIds)
      .catch((err) =>
        this.logger.error(
          `Failed to cancel pending reminders for plan ${plan.id}`,
          err,
        ),
      );

    const description =
      paidInstallments.length > 0
        ? `Payment plan cancelled — ${plan.charge_name}. ${paidInstallments.length} of ${plan.installments.length} installment(s) already paid (₦${totalPaid.toLocaleString()}); reconcile separately.`
        : `Payment plan cancelled — ${plan.charge_name}`;

    await this.logPlanEvent(
      'payment_plan_cancelled',
      description,
      plan,
      NotificationType.PAYMENT_PLAN_CANCELLED,
    );

    // A cancelled wallet-backed plan releases its claim on the wallet OB, which
    // returns to any unpaid renewal invoice — re-fold so the renewal collects
    // it again (plan creation excluded it; cancel must restore it).
    if (
      plan.source_type === PaymentPlanSourceType.OUTSTANDING_BALANCE ||
      plan.source_type === PaymentPlanSourceType.AD_HOC_INVOICE ||
      plan.ad_hoc_invoice_id
    ) {
      const property = await this.propertyRepository.findOne({
        where: { id: plan.property_id },
      });
      if (property) {
        // Non-blocking — the cancel is already committed.
        try {
          await this.tenanciesService.refreshInvoiceTotals(
            plan.tenant_id,
            property.owner_id,
          );
        } catch (err) {
          this.logger.warn(
            `Post-cancel renewal re-fold failed for plan ${plan.id}: ${(err as Error)?.message}`,
          );
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Update (reschedule unpaid installments)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Replace a plan's UNPAID installment schedule. Paid installments are
   * preserved untouched; their sum is subtracted from plan.total_amount to
   * determine the budget the new unpaid rows must match exactly.
   *
   * Why not allow editing total_amount? Charge-scope plans carve their total
   * out of the parent renewal invoice at creation (`subtractChargeFromInvoice`)
   * and restore it symmetrically on cancel. Mutating total mid-life would
   * require the invoice to be re-adjusted in lockstep, which is fragile —
   * cancel + re-create is the supported path for that case.
   */
  async updatePlan(
    id: string,
    dto: UpdatePaymentPlanDto,
    updatedByUserId?: string,
  ): Promise<PaymentPlan> {
    const plan = await this.getPlan(id);

    if (plan.status !== PaymentPlanStatus.ACTIVE) {
      throw new ConflictException('Plan is not active');
    }
    if (dto.installments.length < 1) {
      throw new BadRequestException('Plan must have at least one installment');
    }

    const paid = plan.installments.filter(
      (i) => i.status === InstallmentStatus.PAID,
    );
    const unpaid = plan.installments.filter(
      (i) => i.status === InstallmentStatus.PENDING,
    );

    const paidSum = paid.reduce(
      (sum, i) => sum + Number(i.amount_paid ?? i.amount),
      0,
    );
    const remainingBudget = Number(plan.total_amount) - paidSum;

    if (remainingBudget <= 0) {
      throw new ConflictException(
        'Plan is fully paid; nothing left to reschedule',
      );
    }

    const newSum = dto.installments.reduce(
      (sum, i) => sum + Number(i.amount),
      0,
    );
    if (Math.abs(newSum - remainingBudget) > 1) {
      throw new BadRequestException(
        `Installment amounts must sum to ₦${remainingBudget.toLocaleString()} (plan total − already paid)`,
      );
    }

    const cancelledReminderIds = unpaid.map((i) => i.id);
    const maxPaidSequence = paid.reduce(
      (max, i) => Math.max(max, i.sequence),
      0,
    );

    await this.dataSource.transaction(async (manager) => {
      if (unpaid.length > 0) {
        await manager.delete(
          PaymentPlanInstallment,
          unpaid.map((i) => i.id),
        );
      }

      const rows = dto.installments.map((inst, idx) =>
        manager.create(PaymentPlanInstallment, {
          plan_id: plan.id,
          sequence: maxPaidSequence + idx + 1,
          amount: Number(inst.amount),
          due_date: new Date(inst.dueDate),
          status: InstallmentStatus.PENDING,
        }),
      );
      await manager.save(PaymentPlanInstallment, rows);

      if (dto.planType) {
        await manager.update(PaymentPlan, plan.id, { plan_type: dto.planType });
      }
    });

    // Cancel pending reminders queued against the deleted installment ids.
    await this.whatsappNotificationLog
      .cancelPendingByReferenceIds(cancelledReminderIds)
      .catch((err) =>
        this.logger.error(
          `Failed to cancel stale reminders for plan ${plan.id}`,
          err,
        ),
      );

    const fresh = await this.getPlan(plan.id);

    await this.logPlanEvent(
      'payment_plan_updated',
      `Payment plan updated — ${plan.charge_name}. ${paid.length} paid + ${dto.installments.length} rescheduled installment(s).`,
      fresh,
      NotificationType.PAYMENT_PLAN_UPDATED,
    );

    return fresh;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Initialize Paystack for an installment
  // ───────────────────────────────────────────────────────────────────────

  async initializeInstallmentPayment(
    installmentId: string,
    email: string,
  ): Promise<PlanPaymentInitializationResult> {
    const installment = await this.getInstallment(installmentId);

    if (installment.status === InstallmentStatus.PAID) {
      throw new ConflictException('Installment is already paid');
    }
    if (installment.plan.status !== PaymentPlanStatus.ACTIVE) {
      throw new ConflictException('Plan is no longer active');
    }

    const amount = Number(installment.amount);
    const reference = `PLAN_${Date.now()}_${uuidv4().substring(0, 8)}`;

    const paystackResponse = await this.paystackService.initializeTransaction({
      email,
      amount: Math.round(amount * 100),
      reference,
      callback_url: `${process.env.FRONTEND_URL}/payment-plan/installment/${installment.id}`,
      metadata: {
        payment_plan_installment_id: installment.id,
        payment_plan_id: installment.plan_id,
        property_id: installment.plan.property_id,
        tenant_id: installment.plan.tenant_id,
        charge_name: installment.plan.charge_name,
        installment_sequence: installment.sequence,
      },
      channels: ['card', 'bank_transfer'],
    });

    this.logger.log(
      `Paystack initialized for installment ${installment.id}, reference: ${reference}`,
    );

    return {
      accessCode: paystackResponse.data.access_code,
      reference,
      authorizationUrl: paystackResponse.data.authorization_url,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Pay a whole plan off early (one lump = total − already paid)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Quote the remaining balance for an early full payoff: plan total minus
   * everything already paid. Drives the tenant's "Pay it all now" button —
   * which can sit on the original invoice page; under the hood it routes into
   * the plan's single settlement path (no second public link to race the
   * installment links).
   */
  async getPlanPayoffQuote(planId: string): Promise<{
    planId: string;
    chargeName: string;
    scope: PaymentPlanScope;
    status: PaymentPlanStatus;
    totalAmount: number;
    paidAmount: number;
    remaining: number;
    totalInstallments: number;
    installmentsRemaining: number;
    property: { id: string; name: string; address: string };
    tenant: { name: string; email: string | null };
    landlordBranding: Record<string, unknown> | null;
    landlordLogoUrl: string | null;
  }> {
    const plan = await this.getPlan(planId);
    const installments = plan.installments ?? [];
    const paidAmount = installments
      .filter((i) => i.status === InstallmentStatus.PAID)
      .reduce((s, i) => s + Number(i.amount_paid ?? i.amount), 0);

    const property = plan.property;
    const landlordUser = property?.owner?.user;
    const landlordBranding =
      (landlordUser?.branding as Record<string, unknown> | undefined) || null;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] ||
      (landlordBranding?.letterhead as string | undefined) ||
      null;
    const tenantUser = plan.tenant?.user;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : '';
    const tenantEmail =
      ((plan.tenant as { email?: string })?.email ?? tenantUser?.email) || null;

    return {
      planId: plan.id,
      chargeName: plan.charge_name,
      scope: plan.scope,
      status: plan.status,
      totalAmount: Number(plan.total_amount),
      paidAmount,
      remaining: Math.max(0, Number(plan.total_amount) - paidAmount),
      totalInstallments: installments.length,
      installmentsRemaining: installments.filter(
        (i) => i.status === InstallmentStatus.PENDING,
      ).length,
      property: {
        id: property?.id ?? '',
        name: property?.name ?? '',
        address: property?.location ?? '',
      },
      tenant: { name: tenantName, email: tenantEmail },
      landlordBranding,
      landlordLogoUrl,
    };
  }

  /**
   * Initialize a Paystack charge for the WHOLE remaining plan balance so a
   * tenant can clear the plan in one payment instead of waiting out the
   * installments.
   */
  async initializePlanPayoffPayment(
    planId: string,
    email: string,
  ): Promise<PlanPaymentInitializationResult> {
    const plan = await this.getPlan(planId);
    if (plan.status !== PaymentPlanStatus.ACTIVE) {
      throw new ConflictException('This plan is no longer active');
    }
    const paidAmount = (plan.installments ?? [])
      .filter((i) => i.status === InstallmentStatus.PAID)
      .reduce((s, i) => s + Number(i.amount_paid ?? i.amount), 0);
    const remaining = Math.max(0, Number(plan.total_amount) - paidAmount);
    if (remaining <= 0) {
      throw new ConflictException('This plan is already fully paid');
    }

    const reference = `PLANPAYOFF_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const paystackResponse = await this.paystackService.initializeTransaction({
      email,
      amount: Math.round(remaining * 100),
      reference,
      callback_url: `${process.env.FRONTEND_URL}/payment-plan/${plan.id}/payoff`,
      metadata: {
        payment_plan_payoff_id: plan.id,
        payment_plan_id: plan.id,
        property_id: plan.property_id,
        tenant_id: plan.tenant_id,
        charge_name: plan.charge_name,
      },
      channels: ['card', 'bank_transfer'],
    });

    this.logger.log(
      `Paystack initialized for plan payoff ${plan.id}, reference: ${reference}`,
    );

    return {
      accessCode: paystackResponse.data.access_code,
      reference,
      authorizationUrl: paystackResponse.data.authorization_url,
    };
  }

  /**
   * Tenant-facing verify for a plan payoff — idempotent with the webhook.
   */
  async verifyPlanPayoffPayment(
    planId: string,
    reference: string,
  ): Promise<{
    status: 'success' | 'failed' | 'pending';
    reference: string;
    amount: number;
    planStatus: PaymentPlanStatus;
  }> {
    const paystackResponse =
      await this.paystackService.verifyTransaction(reference);
    const data = paystackResponse.data;

    if (data.status !== 'success') {
      const plan = await this.getPlan(planId);
      return {
        status: data.status === 'failed' ? 'failed' : 'pending',
        reference: data.reference,
        amount: data.amount / 100,
        planStatus: plan.status,
      };
    }

    try {
      await this.markPlanPaidOffFromWebhook({
        reference: data.reference,
        amount: data.amount,
        channel: data.channel,
        metadata: { payment_plan_payoff_id: planId },
      });
    } catch (err) {
      this.logger.error(
        `verifyPlanPayoffPayment failed to settle plan ${planId}`,
        (err as Error).stack,
      );
    }

    const fresh = await this.getPlan(planId);
    return {
      status: 'success',
      reference: data.reference,
      amount: data.amount / 100,
      planStatus: fresh.status,
    };
  }

  /**
   * Webhook/verify entry for a plan payoff. Idempotent: a plan that is no
   * longer ACTIVE (already paid off / completed / cancelled) is a no-op.
   */
  async markPlanPaidOffFromWebhook(data: {
    reference: string;
    amount: number;
    channel?: string;
    metadata?: { payment_plan_payoff_id?: string };
  }): Promise<void> {
    const planId = data.metadata?.payment_plan_payoff_id;
    if (!planId) {
      this.logger.error('Plan-payoff webhook missing payment_plan_payoff_id', {
        reference: data.reference,
      });
      throw new Error('Missing payment_plan_payoff_id in metadata');
    }

    const plan = await this.getPlan(planId);
    if (plan.status !== PaymentPlanStatus.ACTIVE) {
      this.logger.log(
        `Plan ${planId} not active (status ${plan.status}); payoff ${data.reference} is a no-op (idempotent)`,
      );
      return;
    }

    await this.payOffPlan(plan, {
      paystackRef: data.reference,
      channel: data.channel,
      method: InstallmentPaymentMethod.PAYSTACK,
      chargedAmount: data.amount / 100,
    });
  }

  /**
   * Settle a whole plan in one lump by paying every still-PENDING installment
   * through the proven per-installment path (CAS claim, wallet credit, FIFO
   * source settlement, renewal ripple, completion) with per-installment
   * notifications suppressed — then emit ONE consolidated "paid off" event.
   *
   * Reusing markInstallmentPaid keeps a single settlement code path and makes a
   * webhook/verify retry naturally idempotent (each installment's status CAS
   * skips the ones already paid). If the charged amount and what was actually
   * applied disagree — a concurrent installment link cleared one of these
   * mid-payoff — the difference is LOGGED for manual reconciliation rather than
   * silently credited (keeps this path free of un-deduped wallet writes).
   */
  private async payOffPlan(
    plan: PaymentPlan,
    args: {
      paystackRef: string;
      channel?: string;
      method: InstallmentPaymentMethod;
      chargedAmount: number;
    },
  ): Promise<void> {
    const pending = (plan.installments ?? [])
      .filter((i) => i.status === InstallmentStatus.PENDING)
      .sort((a, b) => a.sequence - b.sequence);

    for (const row of pending) {
      const inst = await this.getInstallment(row.id);
      if (inst.status !== InstallmentStatus.PENDING) continue;
      await this.markInstallmentPaid(inst, {
        amount: Number(inst.amount),
        method: args.method,
        channel: args.channel,
        paystackRef: args.paystackRef,
        suppressNotifications: true,
      });
    }

    // What this payoff actually settled (installments now PAID under its ref).
    const after = await this.installmentRepository.find({
      where: { plan_id: plan.id },
    });
    const appliedByPayoff = after
      .filter(
        (i) =>
          i.status === InstallmentStatus.PAID &&
          i.paystack_reference === args.paystackRef,
      )
      .reduce((s, i) => s + Number(i.amount_paid ?? i.amount), 0);

    // Reconciliation guard: charged ≠ applied means an installment link cleared
    // one of these at the same moment as the payoff. The funds are real; flag
    // for ops rather than auto-crediting (keeps the payoff idempotent).
    if (Math.abs(args.chargedAmount - appliedByPayoff) > 1) {
      this.logger.warn(
        `Plan payoff ${args.paystackRef} on plan ${plan.id}: charged ₦${args.chargedAmount} but applied ₦${appliedByPayoff}.`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: plan.property_id,
          tenant_id: plan.tenant_id,
          event_type: 'payment_plan_payoff_discrepancy',
          event_description: `Early payoff of "${plan.charge_name}" charged ₦${args.chargedAmount.toLocaleString()} but only ₦${appliedByPayoff.toLocaleString()} mapped to open installments (an installment was likely paid at the same moment). Reconcile/refund the ₦${Math.max(0, args.chargedAmount - appliedByPayoff).toLocaleString()} difference.`,
          related_entity_id: plan.id,
          related_entity_type: 'payment_plan',
          metadata: {
            reference: args.paystackRef,
            charged: args.chargedAmount,
            applied: appliedByPayoff,
          },
        }),
      );
    }

    const fresh = await this.getPlan(plan.id);
    const completed = fresh.status === PaymentPlanStatus.COMPLETED;

    await this.logPlanEvent(
      completed ? 'payment_plan_completed' : 'payment_plan_installment_paid',
      completed
        ? `Payment plan paid off early — ${plan.charge_name} — ₦${appliedByPayoff.toLocaleString()}`
        : `Partial plan payoff — ${plan.charge_name} — ₦${appliedByPayoff.toLocaleString()}`,
      fresh,
      completed
        ? NotificationType.PAYMENT_PLAN_COMPLETED
        : NotificationType.PAYMENT_PLAN_INSTALLMENT_PAID,
    );

    // Consolidated WhatsApp. Tenancy-scope completion already fires renewal
    // receipts via the per-installment ripple-up, so only message here for
    // charge-scope plans (matches dispatchInstallmentNotifications' gate).
    if (completed && fresh.scope === PaymentPlanScope.CHARGE) {
      await this.dispatchPlanPaidOffNotifications(fresh);
    }
  }

  private async dispatchPlanPaidOffNotifications(
    plan: PaymentPlan,
  ): Promise<void> {
    try {
      const property = plan.property;
      const propertyName = property?.name ?? 'your property';
      const landlordAccount = property?.owner;
      const landlordUser = landlordAccount?.user;
      const tenantUser = plan.tenant?.user;

      const tenantName =
        `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
        'there';
      const landlordName =
        landlordAccount?.profile_name ||
        `${landlordUser?.first_name ?? ''} ${landlordUser?.last_name ?? ''}`.trim() ||
        'there';

      const tenantPhone = tenantUser?.phone_number
        ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
        : null;
      const landlordPhone = landlordUser?.phone_number
        ? this.utilService.normalizePhoneNumber(landlordUser.phone_number)
        : null;

      const totalAmount = Number(plan.total_amount);

      if (tenantPhone) {
        await this.whatsappNotificationLog.queue(
          'sendPaymentPlanCompletedTenant',
          {
            phone_number: tenantPhone,
            tenant_name: tenantName,
            charge_name: plan.charge_name,
            property_name: propertyName,
            total_amount: totalAmount,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: tenantName,
          },
          plan.id,
        );
      }
      if (landlordPhone) {
        await this.whatsappNotificationLog.queue(
          'sendPaymentPlanCompletedLandlord',
          {
            phone_number: landlordPhone,
            tenant_name: tenantName,
            charge_name: plan.charge_name,
            property_name: propertyName,
            total_amount: totalAmount,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: landlordName,
          },
          plan.id,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to queue plan-paid-off WhatsApp for plan ${plan.id}: ${(err as Error).message}`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mark an installment paid — from webhook or manual
  // ───────────────────────────────────────────────────────────────────────

  async markInstallmentPaidFromWebhook(data: {
    reference: string;
    amount: number;
    channel?: string;
    metadata?: { payment_plan_installment_id?: string };
  }): Promise<void> {
    const installmentId = data.metadata?.payment_plan_installment_id;
    if (!installmentId) {
      this.logger.error('Webhook missing payment_plan_installment_id', {
        reference: data.reference,
      });
      throw new Error('Missing payment_plan_installment_id in metadata');
    }

    const installment = await this.getInstallment(installmentId);

    // Idempotency + double-payment detection.
    if (installment.status === InstallmentStatus.PAID) {
      this.logger.warn(
        `Duplicate Paystack payment for already-paid installment ${installmentId} (ref: ${data.reference})`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: installment.plan.property_id,
          tenant_id: installment.plan.tenant_id,
          event_type: 'payment_plan_duplicate_payment',
          event_description: `Duplicate Paystack payment received for installment ${installment.sequence}/${installment.plan.installments?.length ?? '?'} — reference ${data.reference} — refund investigation required`,
          related_entity_id: installment.id,
          related_entity_type: 'payment_plan_installment',
        }),
      );
      return;
    }

    const amountInNaira = data.amount / 100;
    await this.markInstallmentPaid(installment, {
      paystackRef: data.reference,
      amount: amountInNaira,
      method: InstallmentPaymentMethod.PAYSTACK,
      channel: data.channel,
    });
  }

  async markInstallmentPaidManual(
    installmentId: string,
    dto: MarkInstallmentPaidDto,
    markedByUserId: string,
  ): Promise<PaymentPlanInstallment> {
    const installment = await this.getInstallment(installmentId);

    // Authorization — only the property's landlord can mark paid.
    const property = await this.propertyRepository.findOne({
      where: { id: installment.plan.property_id },
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    if (property.owner_id !== markedByUserId) {
      throw new ForbiddenException(
        'Only the property landlord can mark installments paid',
      );
    }

    if (installment.status === InstallmentStatus.PAID) {
      throw new ConflictException('Installment is already paid');
    }
    if (installment.plan.status !== PaymentPlanStatus.ACTIVE) {
      throw new ConflictException('Plan is no longer active');
    }

    const amount = dto.amount ?? Number(installment.amount);
    await this.markInstallmentPaid(installment, {
      amount,
      method: dto.method as InstallmentPaymentMethod,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
      note: dto.note,
      markedByUserId,
    });

    return this.getInstallment(installmentId);
  }

  private async markInstallmentPaid(
    installment: PaymentPlanInstallment,
    args: {
      amount: number;
      method: InstallmentPaymentMethod;
      channel?: string;
      paystackRef?: string;
      paidAt?: Date;
      note?: string;
      markedByUserId?: string;
      // Set by the bulk plan-payoff path: settle the installment (claim, wallet
      // credit, FIFO settlement, ripple) but skip the per-installment activity
      // log + WhatsApp, so a payoff emits ONE consolidated event instead of N.
      suppressNotifications?: boolean;
    },
  ): Promise<void> {
    // Idempotency: webhook and frontend-verify both race to here.
    // Re-read status so the loser doesn't overwrite receipt_token (which is
    // already in the wild via the winner's WhatsApp receipt link).
    const current = await this.installmentRepository.findOne({
      where: { id: installment.id },
      select: ['id', 'status'],
    });
    if (!current || current.status === InstallmentStatus.PAID) {
      this.logger.log(
        `Installment ${installment.id} already paid; skipping (idempotent)`,
      );
      return;
    }

    const paidAt = args.paidAt ?? new Date();
    const receiptToken = `receipt_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const receiptNumber = `PLAN-R-${Date.now()}`;

    const plan = installment.plan;
    const propertyId = plan.property_id;
    const tenantId = plan.tenant_id;

    // Resolve landlord for ledger + manual-payment property_history row.
    const property = await this.propertyRepository.findOne({
      where: { id: propertyId },
    });
    const landlordId = property?.owner_id;

    // Race-loser flag: when the compare-and-swap below finds the installment
    // already claimed by a concurrent webhook/verify, we must skip ALL side
    // effects (wallet credit, settlement, ripple, notifications) — not just the
    // status write — so the wallet is never credited twice for one installment.
    let raceLost = false;
    await this.dataSource.transaction(async (manager) => {
      // 1. Claim the installment with a compare-and-swap on status: the UPDATE
      //    only matches while status is still PENDING. The webhook (setImmediate)
      //    and the frontend verify-payment both reach here for the same row; only
      //    the txn that flips PENDING→PAID gets affected=1. The pre-read above is
      //    a fast path; THIS is the real idempotency guard.
      const claim = await manager.update(
        PaymentPlanInstallment,
        { id: installment.id, status: InstallmentStatus.PENDING },
        {
          status: InstallmentStatus.PAID,
          paid_at: paidAt,
          amount_paid: args.amount,
          // For Paystack payments, persist the actual channel
          // (card / bank_transfer / ussd / ...) so receipts can show it.
          // For manual payments, fall through to the category enum.
          payment_method: (args.channel ?? args.method) as InstallmentPaymentMethod,
          paystack_reference: args.paystackRef ?? null,
          manual_payment_note: args.note ?? null,
          marked_paid_by_user_id: args.markedByUserId ?? null,
          receipt_token: receiptToken,
          receipt_number: receiptNumber,
        },
      );
      if (!claim.affected) {
        raceLost = true;
        return;
      }

      // 2. Apply a ledger entry so tenant balance reflects the payment. The
      //    property/tenant timeline row + livefeed notification for this
      //    installment are written by logPlanEvent in step 5/6 below (which
      //    already runs for both Paystack and manual payments), so there is
      //    deliberately no property_history write here.
      if (landlordId) {
        // Only wallet-backed plans (Outstanding Balance / ad-hoc / arrears)
        // credit the wallet. An invoice-fee charge plan already carved its fee
        // out of the invoice at creation; crediting here would double-reduce the
        // obligation (refreshInvoiceTotals subtracts the wallet from the
        // already-reduced invoice total). See isInvoiceFeeChargePlan. The credit
        // shares THIS transaction (externalManager) so it commits atomically
        // with the status claim — a rollback reverts both, and only the CAS
        // winner ever reaches here.
        if (!this.isInvoiceFeeChargePlan(plan)) {
          await this.tenantBalancesService.applyChange(
            tenantId,
            landlordId,
            args.amount,
            {
              type: TenantBalanceLedgerType.OB_PAYMENT,
              description: `Installment ${installment.sequence} of ${plan.charge_name} — ₦${args.amount.toLocaleString()} (${args.method})`,
              propertyId,
              relatedEntityType: 'payment_plan_installment',
              relatedEntityId: installment.id,
            },
            undefined,
            manager,
          );
        }
      }

      // 3. Check if all installments are now paid and complete the plan.
      const remaining = await manager.count(PaymentPlanInstallment, {
        where: { plan_id: plan.id, status: InstallmentStatus.PENDING },
      });
      if (remaining === 0) {
        await manager.update(PaymentPlan, plan.id, {
          status: PaymentPlanStatus.COMPLETED,
        });
      }
    });

    if (raceLost) {
      this.logger.log(
        `Installment ${installment.id} already claimed by a concurrent payment; skipping (idempotent)`,
      );
      return;
    }

    // 3b. Wallet-backed (Type B) settlement: waterfall this payment across the
    //     plan's frozen FIFO sources and settle any whose residual hits zero
    //     (e.g. mark the covered ad-hoc invoice PAID, credit-free). Runs in its
    //     own transaction — like the invoice ripple below — so a settlement
    //     hiccup can never roll back the already-recorded installment payment.
    //     No-ops for tenancy plans and legacy OB plans (which have no sources).
    if (landlordId && !this.isInvoiceFeeChargePlan(plan)) {
      try {
        await this.settleWalletBackedSources(plan, installment, args.amount);
      } catch (err) {
        this.logger.error(
          `FIFO settlement failed for installment ${installment.id} on plan ${plan.id}: ${(err as Error)?.message}`,
        );
      }
    }

    // 4. Ripple up to the parent renewal invoice for tenancy-scope plans.
    //    Charge-scope plans already carved their portion out of the invoice
    //    at plan-creation time, so their installment payments must NOT
    //    touch the invoice again.
    //
    //    For partial installments we update the invoice directly (accumulate
    //    amount_paid, mark PARTIAL) — we do NOT call markInvoiceAsPaid
    //    because it would overwrite amount_paid with just this installment,
    //    duplicate the OB_PAYMENT ledger credit we already wrote above, and
    //    fire "outstanding balance" notifications on top of our installment
    //    notifications.
    //
    //    Only when the plan completes do we call markInvoiceAsPaid with the
    //    full invoice total to trigger renewal rent-advance and notifications.
    //    skipLedger=true prevents the duplicate OB_PAYMENT credit.
    if (
      plan.scope === PaymentPlanScope.TENANCY &&
      plan.renewal_invoice_id
    ) {
      try {
        const invoice = await this.renewalInvoiceRepository.findOne({
          where: { id: plan.renewal_invoice_id },
        });
        if (invoice && invoice.payment_status !== RenewalPaymentStatus.PAID) {
          const ref =
            args.paystackRef ??
            `PLAN_MANUAL_${installment.id}_${Date.now()}`;

          // Don't ripple up to a superseded invoice: the landlord revised the
          // letter, the new invoice carries the canonical terms, and writing
          // amount_paid / running rent-advance against the old row would lock
          // in stale dates and fees. The OB_PAYMENT credit at step 2 above is
          // still correct (the tenant paid real money) — it just lands in the
          // wallet as overpayment until the new invoice is paid against the
          // refreshed wallet balance. Log a property_history entry so the
          // landlord can see what happened.
          if (invoice.superseded_by_id) {
            this.logger.warn(
              `Installment ${installment.id} on plan ${plan.id} ripple-up skipped: invoice ${invoice.id} was superseded by ${invoice.superseded_by_id}. Funds remain as wallet credit.`,
            );
            try {
              await this.propertyHistoryRepository.save(
                this.propertyHistoryRepository.create({
                  property_id: plan.property_id,
                  tenant_id: plan.tenant_id,
                  event_type: 'renewal_invoice_orphaned_payment',
                  event_description: `Installment ${installment.sequence} of "${plan.charge_name}" (₦${args.amount.toLocaleString()}) credited to tenant wallet — the linked renewal invoice was superseded by a revised letter. Cancel the plan and rebuild it against the current invoice.`,
                  related_entity_id: installment.id,
                  related_entity_type: 'payment_plan_installment',
                  metadata: {
                    payment_plan_id: plan.id,
                    superseded_invoice_id: invoice.id,
                    current_invoice_id: invoice.superseded_by_id,
                    amount: args.amount,
                    payment_method: args.method,
                  },
                }),
              );
            } catch (historyErr) {
              this.logger.warn(
                `Failed to log orphaned-payment history for installment ${installment.id}: ${(historyErr as Error)?.message}`,
              );
            }
            return;
          }

          const planCompleted = await this.dataSource
            .getRepository(PaymentPlan)
            .findOne({ where: { id: plan.id } })
            .then((p) => p?.status === PaymentPlanStatus.COMPLETED);

          if (planCompleted) {
            // Final installment: trigger full renewal path (rent-advance +
            // renewal notifications). Re-read total_amount in case the
            // invoice was edited mid-plan. skipLedger avoids double-crediting
            // because step 2 above already wrote the OB_PAYMENT entry.
            const fresh = await this.renewalInvoiceRepository.findOne({
              where: { id: invoice.id },
            });
            const invoiceTotal = Number(fresh?.total_amount ?? 0);
            await this.tenanciesService.markInvoiceAsPaid(
              invoice.token,
              ref,
              invoiceTotal,
              'full',
              true,
            );
          } else {
            // Partial: accumulate amount_paid and mark PARTIAL atomically
            // (UPDATE ... SET x = x + y) so concurrent installment payments
            // don't lose increments.
            await this.renewalInvoiceRepository
              .createQueryBuilder()
              .update(RenewalInvoice)
              .set({
                amount_paid: () => `COALESCE(amount_paid, 0) + ${args.amount}`,
                payment_status: RenewalPaymentStatus.PARTIAL,
                payment_reference: ref,
              })
              .where('id = :id', { id: invoice.id })
              .execute();
          }
        }
      } catch (error) {
        // INVOICE_SUPERSEDED races: the invoice was superseded between our
        // pre-check and the markInvoiceAsPaid call. Treat the same way as
        // the proactive branch above — leave the OB credit, log, move on.
        const code = (error as { response?: { code?: string } })?.response
          ?.code;
        if (code === 'INVOICE_SUPERSEDED') {
          this.logger.warn(
            `Installment ${installment.id} ripple-up race: invoice superseded mid-flight. Funds remain as wallet credit.`,
          );
        } else {
          this.logger.warn(
            `Invoice ripple-up for installment ${installment.id} skipped: ${error.message}`,
          );
        }
      }
    }

    // 5 & 6. Per-installment activity log + WhatsApp receipt/heads-up. Skipped
    //   for a bulk plan-payoff (suppressNotifications): payOffPlan emits one
    //   consolidated "paid off" event instead of one per installment.
    if (!args.suppressNotifications) {
      const methodLabel =
        args.method === InstallmentPaymentMethod.PAYSTACK
          ? 'paystack'
          : args.method;
      const totalInstallments = plan.installments?.length;
      const seqLabel = totalInstallments
        ? `${installment.sequence}/${totalInstallments}`
        : `${installment.sequence}`;

      const refreshedPlan = await this.getPlan(plan.id);

      await this.logPlanEvent(
        'payment_plan_installment_paid',
        `Installment ${seqLabel} paid — ₦${args.amount.toLocaleString()} (${methodLabel})`,
        refreshedPlan,
        NotificationType.PAYMENT_PLAN_INSTALLMENT_PAID,
        installment.id,
        'payment_plan_installment',
        // Lets the timeline row deep-link to the installment receipt page.
        { receiptToken },
      );

      if (refreshedPlan.status === PaymentPlanStatus.COMPLETED) {
        await this.logPlanEvent(
          'payment_plan_completed',
          `Payment plan completed — ${plan.charge_name}`,
          refreshedPlan,
          NotificationType.PAYMENT_PLAN_COMPLETED,
        );
      }

      await this.dispatchInstallmentNotifications(
        refreshedPlan,
        installment.id,
        seqLabel,
        args.amount,
        receiptToken,
      );
    }
  }

  /**
   * Waterfall an installment payment across a wallet-backed plan's frozen FIFO
   * sources (oldest `due_seq` first), recording each application as a
   * `payment_plan_allocation` row. When a source's derived residual
   * (`covered_amount − Σ allocations`) reaches zero, the underlying ad-hoc
   * invoice is marked PAID **credit-free** — the wallet was already credited by
   * the installment's OB_PAYMENT, so a second credit would double-reduce.
   *
   * Runs in its own transaction with the sources locked FOR UPDATE; the
   * `(installment_id, source_id)` unique index plus the "already allocated"
   * guard make a webhook/verify retry a no-op. No-ops for plans with no
   * sources (tenancy, legacy OB) — those keep their pre-feature behaviour.
   */
  private async settleWalletBackedSources(
    plan: PaymentPlan,
    installment: PaymentPlanInstallment,
    amount: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const sources = await manager.find(PaymentPlanSource, {
        where: { plan_id: plan.id },
        order: { due_seq: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (sources.length === 0) return;

      // Idempotency: this installment already settled (webhook/verify retry).
      const already = await manager.count(PaymentPlanAllocation, {
        where: { installment_id: installment.id },
      });
      if (already > 0) return;

      let remaining = amount;
      for (const source of sources) {
        if (remaining < 0.5) break;

        const allocatedRow = await manager
          .createQueryBuilder(PaymentPlanAllocation, 'a')
          .select('COALESCE(SUM(a.amount), 0)', 'sum')
          .where('a.source_id = :sid', { sid: source.id })
          .getRawOne<{ sum: string }>();
        const residual =
          Number(source.covered_amount) - Number(allocatedRow?.sum ?? 0);
        if (residual <= 0) continue;

        const applied = Math.min(remaining, residual);
        remaining -= applied;

        await manager.save(
          manager.create(PaymentPlanAllocation, {
            plan_id: plan.id,
            installment_id: installment.id,
            source_id: source.id,
            amount: applied,
          }),
        );

        await this.applySourceSettlement(
          manager,
          source,
          residual - applied,
          applied,
        );
      }

      // Overflow: the snapshot was smaller than what was paid (a source shrank
      // or rounding). The surplus is already wallet credit (via OB_PAYMENT) —
      // leave it there and log for traceability. (User decision: no refund.)
      if (remaining > 1) {
        await manager.save(
          manager.create(PropertyHistory, {
            property_id: plan.property_id,
            tenant_id: plan.tenant_id,
            event_type: 'payment_plan_overflow',
            event_description: `Installment ${installment.sequence} of "${plan.charge_name}" overpaid the plan's covered sources by ₦${remaining.toLocaleString()}; surplus left as tenant wallet credit.`,
            related_entity_id: installment.id,
            related_entity_type: 'payment_plan_installment',
            metadata: {
              payment_plan_id: plan.id,
              overflow_amount: remaining,
            },
          }),
        );
      }
    });
  }

  /**
   * Reflect a source's new residual onto its underlying ad-hoc invoice.
   * Credit-free: the wallet was already moved by the installment's OB_PAYMENT.
   */
  private async applySourceSettlement(
    manager: EntityManager,
    source: PaymentPlanSource,
    residualRemaining: number,
    appliedThisInstallment: number,
  ): Promise<void> {
    if (source.source_kind !== PaymentPlanSourceKind.AD_HOC_INVOICE) return;
    if (!source.source_ad_hoc_invoice_id) return;

    const invoice = await manager.findOne(AdHocInvoice, {
      where: { id: source.source_ad_hoc_invoice_id },
    });
    if (
      !invoice ||
      invoice.status === AdHocInvoiceStatus.PAID ||
      invoice.status === AdHocInvoiceStatus.CANCELLED
    ) {
      return;
    }

    // When this source's residual reaches 0 the invoice is SETTLED — even if the
    // plan only partially "covered" it. Partial coverage (covered_amount < the
    // invoice's outstanding) arises only when the wallet holds a credit that
    // offsets ad-hoc debt: enumerate proved plannableOB ≥ Σ uncovered-ad-hoc
    // outstanding whenever the wallet has no net credit, so a shortfall means a
    // credit already paid the difference. Mark the invoice PAID and CLEAR its
    // coverage so the completed plan never strands it (the public link stays
    // locked by the PAID status, and it drops out of plannable).
    //
    // Mid-plan (residual > 0) it is PARTIAL; amount_paid ACCUMULATES the amount
    // applied this installment onto whatever was already paid (an ad-hoc may
    // enter a plan already partially paid), so the running figure — and the
    // remaining the re-opened public link would charge on cancel — stays right.
    const total = Number(invoice.total_amount);
    const fullyPaid = residualRemaining <= 1;
    const accumulated = Math.min(
      total,
      Number(invoice.amount_paid ?? 0) + appliedThisInstallment,
    );
    await manager.update(AdHocInvoice, invoice.id, {
      status: fullyPaid
        ? AdHocInvoiceStatus.PAID
        : AdHocInvoiceStatus.PARTIAL,
      amount_paid: fullyPaid ? total : accumulated,
      ...(fullyPaid
        ? {
            paid_at: new Date(),
            payment_method: 'payment_plan',
            covered_by_plan_id: null,
          }
        : {}),
    });
  }

  private async dispatchInstallmentNotifications(
    plan: PaymentPlan,
    installmentId: string,
    installmentLabel: string,
    amount: number,
    receiptToken: string,
  ): Promise<void> {
    try {
      const property = plan.property;
      const propertyName = property?.name ?? 'your property';
      const landlordAccount = property?.owner;
      const landlordUser = landlordAccount?.user;
      const tenantUser = plan.tenant?.user;

      const tenantName =
        `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
        'there';
      const landlordName =
        landlordAccount?.profile_name ||
        `${landlordUser?.first_name ?? ''} ${landlordUser?.last_name ?? ''}`.trim() ||
        'there';

      const tenantPhone = tenantUser?.phone_number
        ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
        : null;
      const landlordPhone = landlordUser?.phone_number
        ? this.utilService.normalizePhoneNumber(landlordUser.phone_number)
        : null;

      // Tenant-facing label: tenancy-scope plans read as "Tenancy", not the
      // stored "Entire Tenancy" sentinel. Landlord-facing messages below
      // keep the raw stored value.
      const tenantDisplayChargeName =
        plan.scope === PaymentPlanScope.TENANCY ? 'Tenancy' : plan.charge_name;

      if (tenantPhone) {
        await this.whatsappNotificationLog.queue(
          'sendInstallmentReceiptTenant',
          {
            phone_number: tenantPhone,
            tenant_name: tenantName,
            amount,
            charge_name: tenantDisplayChargeName,
            property_name: propertyName,
            receipt_token: receiptToken,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: tenantName,
          },
          installmentId,
        );
      }

      if (landlordPhone) {
        await this.whatsappNotificationLog.queue(
          'sendInstallmentPaidLandlord',
          {
            phone_number: landlordPhone,
            tenant_name: tenantName,
            installment_label: installmentLabel,
            charge_name: plan.charge_name,
            property_name: propertyName,
            amount,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: landlordName,
          },
          installmentId,
        );
      }

      // Plan completion — charge-scope only, since tenancy-scope
      // completion already fires sendRenewalPayment* via the ripple-up.
      if (
        plan.status === PaymentPlanStatus.COMPLETED &&
        plan.scope === PaymentPlanScope.CHARGE
      ) {
        const totalAmount = Number(plan.total_amount);
        if (tenantPhone) {
          await this.whatsappNotificationLog.queue(
            'sendPaymentPlanCompletedTenant',
            {
              phone_number: tenantPhone,
              tenant_name: tenantName,
              charge_name: plan.charge_name,
              property_name: propertyName,
              total_amount: totalAmount,
              landlord_id: property?.owner_id,
              property_id: property?.id,
              recipient_name: tenantName,
            },
            plan.id,
          );
        }
        if (landlordPhone) {
          await this.whatsappNotificationLog.queue(
            'sendPaymentPlanCompletedLandlord',
            {
              phone_number: landlordPhone,
              tenant_name: tenantName,
              charge_name: plan.charge_name,
              property_name: propertyName,
              total_amount: totalAmount,
              landlord_id: property?.owner_id,
              property_id: property?.id,
              recipient_name: landlordName,
            },
            plan.id,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to queue WhatsApp notifications for installment ${installmentId}: ${(err as Error).message}`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers — fee subtraction / restoration on the renewal invoice
  // ───────────────────────────────────────────────────────────────────────

  private async subtractChargeFromInvoice(
    manager: EntityManager,
    invoiceId: string,
    feeKind: FeeKind,
    externalId: string | null,
    chargeLabel: string,
    chargeAmount: number,
  ): Promise<void> {
    const invoice = await manager.findOne(RenewalInvoice, {
      where: { id: invoiceId },
    });
    if (!invoice) return;

    const breakdown: Fee[] = Array.isArray(invoice.fee_breakdown)
      ? [...invoice.fee_breakdown]
      : [];
    const idx = breakdown.findIndex((f) =>
      feeKind === 'other'
        ? f.kind === 'other' &&
          (externalId ? f.externalId === externalId : f.label === chargeLabel)
        : f.kind === feeKind,
    );

    // Virtual Outstanding Balance lives in the invoice column, not breakdown.
    const isVirtualOb =
      feeKind === 'other' && externalId === 'outstanding_balance';

    if (idx === -1 && !isVirtualOb) {
      throw new BadRequestException(
        `Charge "${chargeLabel}" no longer present on the renewal invoice`,
      );
    }

    if (idx !== -1) {
      breakdown.splice(idx, 1);
    }

    // Also keep the legacy other_fees array in sync for kind:'other'.
    let otherFees = Array.isArray(invoice.other_fees)
      ? [...invoice.other_fees]
      : [];
    if (feeKind === 'other') {
      otherFees = otherFees.filter((f) =>
        externalId ? f.externalId !== externalId : f.name !== chargeLabel,
      );
    }

    // Zero out the matching scalar column so the legacy fallback rendering
    // stays consistent with the trimmed breakdown.
    const updates: Partial<RenewalInvoice> = {
      fee_breakdown: breakdown,
      other_fees: otherFees,
      total_amount: Math.max(
        0,
        Number(invoice.total_amount) - chargeAmount,
      ),
      outstanding_balance: Math.max(
        0,
        Number(invoice.outstanding_balance) - chargeAmount,
      ),
    };
    switch (feeKind) {
      case 'rent':
        updates.rent_amount = 0;
        break;
      case 'service':
        updates.service_charge = 0;
        break;
      case 'caution':
        updates.caution_deposit = 0;
        break;
      case 'legal':
        updates.legal_fee = 0;
        break;
      case 'agency':
        updates.agency_fee = 0;
        break;
      case 'other':
        // other_charges is a scalar aggregate; only touch if it's the only
        // "other" left. Otherwise leave it alone — the real entries live in
        // fee_breakdown/other_fees.
        break;
    }

    await manager.update(RenewalInvoice, invoiceId, updates);
  }

  private async restoreChargeToInvoice(
    manager: EntityManager,
    invoiceId: string,
    feeKind: FeeKind,
    externalId: string | null,
    chargeLabel: string,
    chargeAmount: number,
  ): Promise<void> {
    const invoice = await manager.findOne(RenewalInvoice, {
      where: { id: invoiceId },
    });
    if (!invoice) return;

    const breakdown: Fee[] = Array.isArray(invoice.fee_breakdown)
      ? [...invoice.fee_breakdown]
      : [];

    // Virtual OB wasn't in breakdown to begin with — restore the column only.
    const isVirtualOb =
      feeKind === 'other' && externalId === 'outstanding_balance';

    if (!isVirtualOb) {
      breakdown.push({
        kind: feeKind,
        label: chargeLabel,
        amount: chargeAmount,
        recurring: feeKind === 'rent' || feeKind === 'service',
        ...(externalId ? { externalId } : {}),
      });
    }

    const updates: Partial<RenewalInvoice> = {
      fee_breakdown: breakdown,
      total_amount: Number(invoice.total_amount) + chargeAmount,
      outstanding_balance:
        Number(invoice.outstanding_balance) + chargeAmount,
    };
    switch (feeKind) {
      case 'rent':
        updates.rent_amount = chargeAmount;
        break;
      case 'service':
        updates.service_charge = chargeAmount;
        break;
      case 'caution':
        updates.caution_deposit = chargeAmount;
        break;
      case 'legal':
        updates.legal_fee = chargeAmount;
        break;
      case 'agency':
        updates.agency_fee = chargeAmount;
        break;
      case 'other': {
        if (isVirtualOb) break;
        const otherFees = Array.isArray(invoice.other_fees)
          ? [...invoice.other_fees]
          : [];
        if (externalId && !otherFees.some((f) => f.externalId === externalId)) {
          otherFees.push({
            externalId,
            name: chargeLabel,
            amount: chargeAmount,
            recurring: false,
          });
        }
        updates.other_fees = otherFees;
        break;
      }
    }

    await manager.update(RenewalInvoice, invoiceId, updates);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Logging — property history + landlord livefeed + WebSocket push
  // ───────────────────────────────────────────────────────────────────────

  private async logPlanEvent(
    eventType: string,
    description: string,
    plan: PaymentPlan,
    notificationType: NotificationType,
    relatedEntityId?: string,
    relatedEntityType?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      // Property/tenant timeline row (single write hits both views). `metadata`
      // carries structured extras the timeline builder needs — e.g. the
      // installment receipt token so the row can deep-link to the receipt page.
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: plan.property_id,
          tenant_id: plan.tenant_id,
          event_type: eventType,
          event_description: description,
          related_entity_id: relatedEntityId ?? plan.id,
          related_entity_type: relatedEntityType ?? 'payment_plan',
          metadata: metadata ?? null,
        }),
      );

      // Landlord livefeed.
      const property = await this.propertyRepository.findOne({
        where: { id: plan.property_id },
      });
      const landlordId = property?.owner_id;
      if (!landlordId) return;

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: notificationType,
        description,
        status: 'Completed',
        property_id: plan.property_id,
        user_id: landlordId,
      });

      this.eventsGateway.emitHistoryAdded(landlordId, {
        propertyId: plan.property_id,
        propertyName: property?.name ?? '',
        tenantName:
          plan.tenant?.user?.first_name && plan.tenant?.user?.last_name
            ? `${plan.tenant.user.first_name} ${plan.tenant.user.last_name}`
            : '',
        displayType: notificationType,
        description,
      });
    } catch (error) {
      this.logger.error(
        `Failed to log plan event ${eventType} for plan ${plan.id}`,
        error,
      );
    }
  }
}
