import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  PaymentPlan,
  PaymentPlanScope,
  PaymentPlanStatus,
  PaymentPlanType,
} from './entities/payment-plan.entity';
import {
  InstallmentPaymentMethod,
  InstallmentStatus,
  PaymentPlanInstallment,
} from './entities/payment-plan-installment.entity';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
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
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly utilService: UtilService,
    private readonly requestsService: PaymentPlanRequestsService,
  ) {}

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

    // Locate the target renewal invoice — the current unpaid landlord
    // invoice for this tenancy. Either we were handed an id explicitly,
    // or we look up the latest unpaid one.
    const invoice = dto.renewalInvoiceId
      ? await this.renewalInvoiceRepository.findOne({
          where: { id: dto.renewalInvoiceId },
        })
      : await this.renewalInvoiceRepository.findOne({
          where: {
            property_tenant_id: dto.propertyTenantId,
            payment_status: RenewalPaymentStatus.UNPAID,
            token_type: 'landlord',
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
      if (!fee) {
        throw new BadRequestException(
          `Charge "${dto.chargeName}" not found on the current renewal invoice`,
        );
      }
      chargeFeeKind = fee.kind;
      chargeExternalId = fee.externalId ?? null;
      chargeAmount = Number(fee.amount);
      chargeName = fee.label;

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

    return this.getPlan(saved.id);
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
      relations: ['installments', 'property', 'tenant', 'tenant.user'],
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
    const anyPaid = plan.installments.some(
      (i) => i.status === InstallmentStatus.PAID,
    );
    if (anyPaid) {
      throw new ConflictException(
        'Cannot cancel a plan that already has paid installments',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      // Charge-scope: restore the fee to the parent invoice breakdown.
      if (
        plan.scope === PaymentPlanScope.CHARGE &&
        plan.renewal_invoice_id &&
        plan.charge_fee_kind
      ) {
        await this.restoreChargeToInvoice(
          manager,
          plan.renewal_invoice_id,
          plan.charge_fee_kind,
          plan.charge_external_id,
          plan.charge_name,
          Number(plan.total_amount),
        );
      }
      await manager.update(PaymentPlan, plan.id, {
        status: PaymentPlanStatus.CANCELLED,
      });
    });

    await this.logPlanEvent(
      'payment_plan_cancelled',
      `Payment plan cancelled — ${plan.charge_name}`,
      plan,
      NotificationType.PAYMENT_PLAN_CANCELLED,
    );
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
  // Mark an installment paid — from webhook or manual
  // ───────────────────────────────────────────────────────────────────────

  async markInstallmentPaidFromWebhook(data: {
    reference: string;
    amount: number;
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
      paystackRef?: string;
      paidAt?: Date;
      note?: string;
      markedByUserId?: string;
    },
  ): Promise<void> {
    const paidAt = args.paidAt ?? new Date();
    const receiptToken = `receipt_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const receiptNumber = `PLAN-R-${Date.now()}`;
    const isManual = args.method !== InstallmentPaymentMethod.PAYSTACK;

    const plan = installment.plan;
    const propertyId = plan.property_id;
    const tenantId = plan.tenant_id;

    // Resolve landlord for ledger + manual-payment property_history row.
    const property = await this.propertyRepository.findOne({
      where: { id: propertyId },
    });
    const landlordId = property?.owner_id;

    await this.dataSource.transaction(async (manager) => {
      // 1. Mark the installment paid.
      await manager.update(PaymentPlanInstallment, installment.id, {
        status: InstallmentStatus.PAID,
        paid_at: paidAt,
        amount_paid: args.amount,
        payment_method: args.method,
        paystack_reference: args.paystackRef ?? null,
        manual_payment_note: args.note ?? null,
        marked_paid_by_user_id: args.markedByUserId ?? null,
        receipt_token: receiptToken,
        receipt_number: receiptNumber,
      });

      // 2. Apply a ledger entry so tenant balance reflects the payment.
      //    For manual payments, also write a user_added_payment row so the
      //    existing property_history aggregation picks it up — matches the
      //    renewal-invoice manual-payment path.
      if (landlordId) {
        if (isManual) {
          const manualEntry = manager.create(PropertyHistory, {
            property_id: propertyId,
            tenant_id: tenantId,
            event_type: 'user_added_payment',
            event_description: JSON.stringify({
              paymentAmount: args.amount,
              paymentMethod: args.method,
              source: 'payment_plan_installment',
              paymentPlanId: plan.id,
              installmentId: installment.id,
              sequence: installment.sequence,
              note: args.note ?? null,
            }),
            related_entity_id: installment.id,
            related_entity_type: 'payment_plan_installment',
            move_in_date: paidAt,
          });
          await manager.save(manualEntry);
        }

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
        );
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
        this.logger.warn(
          `Invoice ripple-up for installment ${installment.id} skipped: ${error.message}`,
        );
      }
    }

    // 5. Activity log + livefeed notification.
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
    );

    if (refreshedPlan.status === PaymentPlanStatus.COMPLETED) {
      await this.logPlanEvent(
        'payment_plan_completed',
        `Payment plan completed — ${plan.charge_name}`,
        refreshedPlan,
        NotificationType.PAYMENT_PLAN_COMPLETED,
      );
    }

    // 6. WhatsApp notifications — receipt to tenant, heads-up to landlord,
    //    plus plan-completion notifications for charge-scope plans (tenancy-
    //    scope completion already fires sendRenewalPayment* via ripple-up).
    await this.dispatchInstallmentNotifications(
      refreshedPlan,
      installment.id,
      seqLabel,
      args.amount,
      receiptToken,
    );
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
      const landlordUser = property?.owner?.user;
      const tenantUser = plan.tenant?.user;

      const tenantName =
        `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
        'there';
      const landlordName =
        `${landlordUser?.first_name ?? ''} ${landlordUser?.last_name ?? ''}`.trim() ||
        'there';

      const tenantPhone = tenantUser?.phone_number
        ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
        : null;
      const landlordPhone = landlordUser?.phone_number
        ? this.utilService.normalizePhoneNumber(landlordUser.phone_number)
        : null;

      if (tenantPhone) {
        await this.whatsappNotificationLog.queue(
          'sendInstallmentReceiptTenant',
          {
            phone_number: tenantPhone,
            tenant_name: tenantName,
            amount,
            charge_name: plan.charge_name,
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
    if (idx === -1) {
      throw new BadRequestException(
        `Charge "${chargeLabel}" no longer present on the renewal invoice`,
      );
    }

    breakdown.splice(idx, 1);

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
    breakdown.push({
      kind: feeKind,
      label: chargeLabel,
      amount: chargeAmount,
      recurring: feeKind === 'rent' || feeKind === 'service',
      ...(externalId ? { externalId } : {}),
    });

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
  ): Promise<void> {
    try {
      // Property/tenant timeline row (single write hits both views).
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: plan.property_id,
          tenant_id: plan.tenant_id,
          event_type: eventType,
          event_description: description,
          related_entity_id: relatedEntityId ?? plan.id,
          related_entity_type: relatedEntityType ?? 'payment_plan',
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
