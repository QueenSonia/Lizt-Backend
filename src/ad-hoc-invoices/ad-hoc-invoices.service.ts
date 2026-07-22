import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  AdHocInvoice,
  AdHocInvoiceStatus,
} from './entities/ad-hoc-invoice.entity';
import { AdHocInvoiceLineItem } from './entities/ad-hoc-invoice-line-item.entity';
import { CreateAdHocInvoiceDto } from './dto/create-ad-hoc-invoice.dto';
import { UpdateAdHocInvoiceDto } from './dto/update-ad-hoc-invoice.dto';

import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';
import {
  ACTIVE_PAYMENT_GATEWAY,
  BankTransferDetails,
  DuplicateReferenceError,
  NormalizedPaymentEvent,
  PaymentGateway,
} from '../payments/gateway/payment-gateway.interface';
import { fetchBankTransferDetails } from '../payments/gateway/bank-transfer.helper';
import { GatewayRegistryService } from '../payments/gateway/gateway-registry.service';
import { recordAmountMismatchArtifact } from '../payments/gateway/amount-mismatch-artifact';
import {
  attachIntentCheckout,
  discardPaymentIntent,
  recordPaymentIntent,
} from '../payments/gateway/payment-intent.helper';
import {
  PaymentIntent,
  PaymentIntentLane,
} from '../payments/entities/payment-intent.entity';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../utils/utility-service';
import { ManagementScopeService } from '../common/scope/management-scope.service';
import { NotificationRecipientsService } from 'src/common/notify/notification-recipients.service';
import { NotificationCategory } from 'src/common/notify/notification-category.enum';

export interface AdHocInvoiceInitializationResult {
  reference: string;
  /** Hosted-checkout URL — kept as the fallback when `transfer` is null. */
  checkoutUrl: string;
  /**
   * One-time virtual account for the in-app transfer checkout. Null when the
   * gateway can't mint one — the frontend then redirects to checkoutUrl.
   */
  transfer?: BankTransferDetails | null;
  /**
   * @deprecated Legacy popup fields, populated only while the active gateway
   * is Paystack. Dropped in the legacy-retire pass.
   */
  accessCode?: string;
  /** @deprecated Alias of checkoutUrl. */
  authorizationUrl?: string;
}

@Injectable()
export class AdHocInvoicesService {
  private readonly logger = new Logger(AdHocInvoicesService.name);

  constructor(
    @InjectRepository(AdHocInvoice)
    private readonly invoiceRepository: Repository<AdHocInvoice>,
    @InjectRepository(AdHocInvoiceLineItem)
    private readonly lineItemRepository: Repository<AdHocInvoiceLineItem>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(PaymentIntent)
    private readonly paymentIntentRepository: Repository<PaymentIntent>,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    @Inject(ACTIVE_PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly gatewayRegistry: GatewayRegistryService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly utilService: UtilService,
    private readonly scopeService: ManagementScopeService,
    private readonly notificationRecipients: NotificationRecipientsService,
  ) {}

  /**
   * True when `userId` may act on an invoice owned by `ownerId`: either they ARE
   * that landlord, or they are an admin (property manager) who manages them.
   */
  private async canManageOwner(
    ownerId: string,
    userId: string,
  ): Promise<boolean> {
    if (ownerId && ownerId === userId) return true;
    return this.scopeService.managesLandlord(userId, ownerId);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Landlord-facing
  // ───────────────────────────────────────────────────────────────────────

  async createInvoice(
    dto: CreateAdHocInvoiceDto,
    createdByUserId?: string,
  ): Promise<AdHocInvoice> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: dto.propertyTenantId },
      relations: ['property', 'tenant', 'tenant.user'],
    });
    if (!propertyTenant) {
      throw new NotFoundException('Tenancy not found');
    }
    const property = propertyTenant.property;
    if (!property) {
      throw new NotFoundException('Property not found for this tenancy');
    }
    if (
      createdByUserId &&
      !(await this.canManageOwner(property.owner_id, createdByUserId))
    ) {
      throw new ForbiddenException(
        'Only the property landlord can issue invoices',
      );
    }

    if (!Array.isArray(dto.lineItems) || dto.lineItems.length < 1) {
      throw new BadRequestException('Invoice must have at least one line item');
    }
    const totalAmount = dto.lineItems.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    if (totalAmount <= 0) {
      throw new BadRequestException('Total amount must be greater than zero');
    }

    const dueDate = new Date(dto.dueDate);
    if (isNaN(dueDate.getTime())) {
      throw new BadRequestException('Invalid due date');
    }

    const saved = await this.dataSource.transaction(async (manager) =>
      this.createInvoiceCore(manager, {
        propertyTenant,
        lineItems: dto.lineItems.map((item) => ({
          description: item.description,
          amount: Number(item.amount),
        })),
        dueDate,
        notes: dto.notes ?? null,
        createdByUserId: createdByUserId ?? null,
      }),
    );

    const fresh = await this.getInvoiceInternal(saved.id);

    await this.logInvoiceEvent(
      'ad_hoc_invoice_created',
      `Invoice ${saved.invoice_number} generated — ₦${totalAmount.toLocaleString()} (${dto.lineItems.length} line item${dto.lineItems.length === 1 ? '' : 's'})`,
      fresh,
      NotificationType.AD_HOC_INVOICE_CREATED,
    );

    await this.dispatchInvoiceLinkNotification(fresh);

    return fresh;
  }

  /**
   * Transactional core of invoice creation: invoice row + line items + the
   * tenant-wallet debit. Shared with PaymentPlansService so a "new charge +
   * plan" is created atomically in ONE transaction. Sends nothing and logs
   * nothing — the caller owns all post-commit dispatch (the plan path
   * deliberately suppresses the pay-link message because the invoice is born
   * plan-covered and its public link would 409).
   */
  async createInvoiceCore(
    manager: EntityManager,
    args: {
      propertyTenant: PropertyTenant;
      lineItems: { description: string; amount: number }[];
      dueDate: Date;
      notes?: string | null;
      createdByUserId?: string | null;
    },
  ): Promise<AdHocInvoice> {
    const { propertyTenant } = args;
    const property = propertyTenant.property;
    const totalAmount = args.lineItems.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );

    const invoiceNumber = await this.generateInvoiceNumber(manager);
    const publicToken = uuidv4().replace(/-/g, '');

    const invoice = manager.create(AdHocInvoice, {
      invoice_number: invoiceNumber,
      landlord_id: property.owner_id,
      property_id: property.id,
      property_tenant_id: propertyTenant.id,
      tenant_id: propertyTenant.tenant_id,
      public_token: publicToken,
      total_amount: totalAmount,
      status: AdHocInvoiceStatus.PENDING,
      due_date: args.dueDate,
      notes: args.notes ?? null,
      created_by_user_id: args.createdByUserId ?? null,
    });
    const savedInvoice = await manager.save(invoice);

    const lineItems = args.lineItems.map((item, idx) =>
      manager.create(AdHocInvoiceLineItem, {
        invoice_id: savedInvoice.id,
        description: item.description.trim(),
        amount: Number(item.amount),
        sequence: idx + 1,
      }),
    );
    await manager.save(lineItems);

    // Debit the tenant wallet — they now owe this amount.
    await this.tenantBalancesService.applyChange(
      propertyTenant.tenant_id,
      property.owner_id,
      -totalAmount,
      {
        type: TenantBalanceLedgerType.OB_CHARGE,
        description: `Invoice ${invoiceNumber} — ₦${totalAmount.toLocaleString()}`,
        propertyId: property.id,
        relatedEntityType: 'ad_hoc_invoice',
        relatedEntityId: savedInvoice.id,
      },
      undefined,
      manager,
    );

    savedInvoice.line_items = lineItems;
    return savedInvoice;
  }

  /**
   * Post-commit logging for an invoice born inside a payment-plan transaction.
   * Mirrors createInvoice's created-event (livefeed + notification) but does
   * NOT queue the tenant pay-link WhatsApp — the plan-created message is the
   * one tenant-facing send for a combined "new charge + plan".
   */
  async logInvoiceCreatedByPlanEvent(invoiceId: string): Promise<void> {
    const fresh = await this.getInvoiceInternal(invoiceId);
    const count = fresh.line_items?.length ?? 1;
    await this.logInvoiceEvent(
      'ad_hoc_invoice_created',
      `Invoice ${fresh.invoice_number} generated — ₦${Number(fresh.total_amount).toLocaleString()} (${count} line item${count === 1 ? '' : 's'})`,
      fresh,
      NotificationType.AD_HOC_INVOICE_CREATED,
    );
  }

  /**
   * Queue the tenant's public pay-link WhatsApp for an existing invoice — used
   * when cancelling a payment plan re-opens the invoice and the landlord opted
   * to send the link. The link charges total − amount_paid, so a partially
   * collected plan leaves it asking for exactly the remainder.
   */
  async sendInvoiceLinkNotification(invoiceId: string): Promise<void> {
    const fresh = await this.getInvoiceInternal(invoiceId);
    await this.dispatchInvoiceLinkNotification(fresh);
  }

  async updateInvoice(
    id: string,
    dto: UpdateAdHocInvoiceDto,
    userId?: string,
  ): Promise<AdHocInvoice> {
    const invoice = await this.getInvoiceInternal(id);
    if (userId && !(await this.canManageOwner(invoice.landlord_id, userId))) {
      throw new ForbiddenException('Only the landlord can edit this invoice');
    }

    // Only unpaid, non-cancelled invoices may be edited. Compare against the
    // computed status so an overdue-but-pending invoice is still editable.
    const effectiveStatus = this.computeStatus(invoice);
    if (effectiveStatus === AdHocInvoiceStatus.PAID) {
      throw new ConflictException('Cannot edit a paid invoice');
    }
    if (effectiveStatus === AdHocInvoiceStatus.CANCELLED) {
      throw new ConflictException('Cannot edit a cancelled invoice');
    }
    // A covered invoice's amount is frozen into an active payment plan's source
    // snapshot. Editing it would credit/debit the wallet without adjusting the
    // plan's claim, breaking the plannable-OB invariant. Cancel the plan first.
    if (invoice.covered_by_plan_id) {
      throw new ConflictException(
        'This invoice is being settled by a payment plan and cannot be edited. Cancel the plan first.',
      );
    }

    if (!Array.isArray(dto.lineItems) || dto.lineItems.length < 1) {
      throw new BadRequestException('Invoice must have at least one line item');
    }
    const newTotal = dto.lineItems.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    if (newTotal <= 0) {
      throw new BadRequestException('Total amount must be greater than zero');
    }

    const dueDate = new Date(dto.dueDate);
    if (isNaN(dueDate.getTime())) {
      throw new BadRequestException('Invalid due date');
    }

    const oldTotal = Number(invoice.total_amount);
    const delta = newTotal - oldTotal;

    await this.dataSource.transaction(async (manager) => {
      // Re-snapshot line items: drop the old set, insert the new one.
      await manager.delete(AdHocInvoiceLineItem, { invoice_id: invoice.id });
      const lineItems = dto.lineItems.map((item, idx) =>
        manager.create(AdHocInvoiceLineItem, {
          invoice_id: invoice.id,
          description: item.description.trim(),
          amount: Number(item.amount),
          sequence: idx + 1,
        }),
      );
      await manager.save(lineItems);

      await manager.update(AdHocInvoice, invoice.id, {
        total_amount: newTotal,
        due_date: dueDate,
        notes: dto.notes ?? invoice.notes ?? null,
      });

      // Reconcile the tenant wallet by the change in total. The create flow
      // debited OB_CHARGE = -total; mirror that for the delta.
      if (delta > 0) {
        await this.tenantBalancesService.applyChange(
          invoice.tenant_id,
          invoice.landlord_id,
          -delta,
          {
            type: TenantBalanceLedgerType.OB_CHARGE,
            description: `Invoice ${invoice.invoice_number} edited — increased by ₦${delta.toLocaleString()}`,
            propertyId: invoice.property_id,
            relatedEntityType: 'ad_hoc_invoice',
            relatedEntityId: invoice.id,
          },
          undefined,
          manager,
        );
      } else if (delta < 0) {
        await this.tenantBalancesService.applyChange(
          invoice.tenant_id,
          invoice.landlord_id,
          -delta,
          {
            type: TenantBalanceLedgerType.OB_PAYMENT,
            description: `Invoice ${invoice.invoice_number} edited — reduced by ₦${(-delta).toLocaleString()}`,
            propertyId: invoice.property_id,
            relatedEntityType: 'ad_hoc_invoice',
            relatedEntityId: invoice.id,
            // Reversal of part of the original charge (edit-down), not a
            // payment — tagged so the breakdown nets it against the charge.
            metadata: { reversal: true },
          },
          undefined,
          manager,
        );
      }
    });

    const fresh = await this.getInvoiceInternal(invoice.id);

    await this.logInvoiceEvent(
      'ad_hoc_invoice_edited',
      `Invoice ${invoice.invoice_number} edited — total ₦${oldTotal.toLocaleString()} → ₦${newTotal.toLocaleString()} (${dto.lineItems.length} line item${dto.lineItems.length === 1 ? '' : 's'})`,
      fresh,
      NotificationType.AD_HOC_INVOICE_UPDATED,
    );

    return this.withComputedStatus(fresh);
  }

  async listInvoicesForTenancy(
    propertyTenantId: string,
  ): Promise<AdHocInvoice[]> {
    const rows = await this.invoiceRepository.find({
      where: { property_tenant_id: propertyTenantId },
      relations: ['line_items'],
      order: { created_at: 'DESC' },
    });
    return rows.map((inv) => this.withComputedStatus(inv));
  }

  async getInvoice(id: string, landlordId?: string): Promise<AdHocInvoice> {
    const invoice = await this.getInvoiceInternal(id);
    if (
      landlordId &&
      !(await this.canManageOwner(invoice.landlord_id, landlordId))
    ) {
      throw new ForbiddenException('Access denied for this invoice');
    }
    return this.withComputedStatus(invoice);
  }

  async cancelInvoice(id: string, userId?: string): Promise<void> {
    const invoice = await this.getInvoiceInternal(id);
    if (userId && !(await this.canManageOwner(invoice.landlord_id, userId))) {
      throw new ForbiddenException('Only the landlord can cancel this invoice');
    }
    if (invoice.status === AdHocInvoiceStatus.PAID) {
      throw new ConflictException('Cannot cancel a paid invoice');
    }
    if (invoice.status === AdHocInvoiceStatus.CANCELLED) {
      throw new ConflictException('Invoice is already cancelled');
    }
    // A covered invoice is owned by an active payment plan: cancelling it here
    // would reverse the wallet debit while the plan still expects to settle it,
    // breaking the plannable-OB invariant. The plan must be cancelled first
    // (which re-opens this invoice), then it can be cancelled.
    if (invoice.covered_by_plan_id) {
      throw new ConflictException(
        'This invoice is being settled by a payment plan and cannot be cancelled. Cancel the plan first.',
      );
    }

    const totalAmount = Number(invoice.total_amount);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(AdHocInvoice, invoice.id, {
        status: AdHocInvoiceStatus.CANCELLED,
      });

      // Reverse the debit — tenant no longer owes this amount.
      await this.tenantBalancesService.applyChange(
        invoice.tenant_id,
        invoice.landlord_id,
        totalAmount,
        {
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: `Invoice ${invoice.invoice_number} cancelled — reversed ₦${totalAmount.toLocaleString()}`,
          propertyId: invoice.property_id,
          relatedEntityType: 'ad_hoc_invoice',
          relatedEntityId: invoice.id,
          // Reversal of the original charge (not a tenant payment): tagged so
          // the balance breakdown nets it against the charge and hides both,
          // rather than showing it as money received.
          metadata: { reversal: true },
        },
        undefined,
        manager,
      );
    });

    const refreshed = await this.getInvoiceInternal(invoice.id);
    await this.logInvoiceEvent(
      'ad_hoc_invoice_cancelled',
      `Invoice ${invoice.invoice_number} cancelled`,
      refreshed,
      NotificationType.AD_HOC_INVOICE_CANCELLED,
    );

    await this.dispatchInvoiceCancelledNotification(refreshed);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public / tenant-facing
  // ───────────────────────────────────────────────────────────────────────

  async getPublicInvoiceView(publicToken: string): Promise<any> {
    const invoice = await this.invoiceRepository.findOne({
      where: { public_token: publicToken },
      relations: [
        'line_items',
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const property = invoice.property;
    const landlordUser = await this.scopeService.resolveBrandingUserForOwner(
      property?.owner_id,
    );
    const landlordBranding = landlordUser?.branding || null;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] || landlordBranding?.letterhead || null;

    const tenantUser = invoice.tenant?.user;
    const tenantEmail =
      (invoice.tenant as any)?.email ?? tenantUser?.email ?? null;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : '';

    const lineItems = (invoice.line_items ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((item) => ({
        id: item.id,
        sequence: item.sequence,
        description: item.description,
        amount: Number(item.amount),
      }));

    const computedStatus = this.computeStatus(invoice);

    // When a payment plan owns this invoice (covered_by_plan_id), the pay
    // button is locked (initializePublicPayment 409s) — so the page needs
    // somewhere to send the tenant instead. Surface the covering plan's first
    // unpaid installment as the deep-link target. Raw SQL avoids a circular
    // dep with PaymentPlansModule; guarded so a failure degrades to the plain
    // locked notice rather than breaking the page.
    let coveringPlan: any = null;
    if (invoice.covered_by_plan_id) {
      try {
        const plans: { id: string; status: string; charge_name: string }[] =
          await this.invoiceRepository.manager.query(
            `SELECT id, status, charge_name FROM payment_plans
               WHERE id = $1
               LIMIT 1`,
            [invoice.covered_by_plan_id],
          );
        if (plans.length && plans[0].status === 'active') {
          const installments: {
            id: string;
            sequence: number;
            amount: string;
            amount_paid: string | null;
            due_date: Date | string | null;
            status: string;
          }[] = await this.invoiceRepository.manager.query(
            `SELECT id, sequence, amount, amount_paid, due_date, status
               FROM payment_plan_installments
               WHERE plan_id = $1
               ORDER BY sequence ASC`,
            [plans[0].id],
          );
          const next = installments.find((i) => i.status !== 'paid') ?? null;
          coveringPlan = {
            planId: plans[0].id,
            chargeName: plans[0].charge_name,
            totalInstallments: installments.length,
            paidInstallments: installments.filter((i) => i.status === 'paid')
              .length,
            nextInstallment: next
              ? {
                  id: next.id,
                  sequence: next.sequence,
                  amount: Number(next.amount),
                  // Face minus recorded partial payments — the pay cost.
                  remaining: Math.max(
                    0,
                    Number(next.amount) - Number(next.amount_paid ?? 0),
                  ),
                  dueDate: this.formatDate(next.due_date),
                }
              : null,
          };
        }
      } catch (err) {
        this.logger.warn(
          `Covering-plan lookup failed for invoice ${invoice.id}: ${(err as Error)?.message}`,
        );
      }
    }

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        publicToken: invoice.public_token,
        totalAmount: Number(invoice.total_amount),
        amountPaid: Number(invoice.amount_paid ?? 0),
        status: computedStatus,
        coveredByPlan: !!invoice.covered_by_plan_id,
        /**
         * Set when coveredByPlan and the plan is still ACTIVE: the page shows
         * "settled through a payment plan" + a link to nextInstallment. Null
         * for completed/cancelled plans (nothing payable to link to).
         */
        coveringPlan,
        dueDate: this.formatDate(invoice.due_date),
        notes: invoice.notes,
        paidAt: invoice.paid_at
          ? invoice.paid_at instanceof Date
            ? invoice.paid_at.toISOString()
            : invoice.paid_at
          : null,
        paymentReference: invoice.payment_reference ?? null,
        receiptToken: invoice.receipt_token ?? null,
        receiptNumber: invoice.receipt_number ?? null,
        createdAt:
          invoice.created_at instanceof Date
            ? invoice.created_at.toISOString()
            : invoice.created_at,
      },
      lineItems,
      property: {
        id: property?.id,
        name: property?.name,
        address: property?.location,
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

  async initializePublicPayment(
    publicToken: string,
    email: string,
  ): Promise<AdHocInvoiceInitializationResult> {
    const invoice = await this.invoiceRepository.findOne({
      where: { public_token: publicToken },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status === AdHocInvoiceStatus.PAID) {
      throw new ConflictException('Invoice is already paid');
    }
    if (invoice.status === AdHocInvoiceStatus.CANCELLED) {
      throw new ConflictException('Invoice has been cancelled');
    }
    if (invoice.covered_by_plan_id) {
      throw new ConflictException(
        'This invoice is being settled through a payment plan. Pay your plan installments instead.',
      );
    }

    // Charge only the REMAINING balance. An invoice can be PARTIAL — e.g. a
    // payment plan that partially settled it was then cancelled, re-opening this
    // link — so charging the full total would over-collect and over-credit the
    // wallet. amount_paid carries what was already collected.
    const amount = Math.max(
      0,
      Number(invoice.total_amount) - Number(invoice.amount_paid ?? 0),
    );
    if (amount <= 0) {
      throw new ConflictException('Invoice is already fully paid');
    }
    const reference = `INV_${Date.now()}_${uuidv4().substring(0, 8)}`;

    // Built once and shared with the intent below: the sweep falls back to the
    // stored copy when a gateway echoes metadata back empty, so the two must
    // not be allowed to drift.
    const gatewayMetadata = {
      ad_hoc_invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      public_token: invoice.public_token,
      property_id: invoice.property_id,
      tenant_id: invoice.tenant_id,
    };

    // Durable record BEFORE the gateway call — without it, a payment whose
    // webhook and browser-return both fail is never reconciled.
    const intent = await recordPaymentIntent(this.paymentIntentRepository, {
      reference,
      gateway: this.gateway.name,
      lane: PaymentIntentLane.AD_HOC_INVOICE,
      amountNaira: amount,
      relatedEntityId: invoice.id,
      metadata: gatewayMetadata,
    });

    let initResult: Awaited<ReturnType<PaymentGateway['initializePayment']>>;
    try {
      initResult = await this.gateway.initializePayment({
        amountNaira: amount,
        email,
        reference,
        // Redirect back to the PAY page (not /success): the pay page runs the
        // return-verify hook, and the success page's data endpoint is
        // paid-only — it 404s until the verify lands.
        callbackUrl: `${process.env.FRONTEND_URL}/pay-invoice/${invoice.public_token}`,
        metadata: gatewayMetadata,
        channels: ['card', 'bank_transfer'],
      });
    } catch (error) {
      // A duplicate means the reference already exists AT THE GATEWAY, so
      // verifying it would resolve a DIFFERENT transaction and the sweep could
      // credit that money here. Any other failure (timeout especially) may have
      // left a live transaction — keep the intent so the sweep can find it.
      if (error instanceof DuplicateReferenceError) {
        await discardPaymentIntent(
          this.paymentIntentRepository,
          this.logger,
          intent.id,
        );
      }
      throw error;
    }

    this.logger.log(
      `Gateway (${initResult.gateway}) initialized for invoice ${invoice.id}, reference: ${reference}`,
    );

    await attachIntentCheckout(
      this.paymentIntentRepository,
      this.logger,
      intent.id,
      initResult,
    );

    // In-app transfer checkout: mint the one-time virtual account in the SAME
    // request (never throws — transfer:null falls back to the hosted redirect).
    const transfer = await fetchBankTransferDetails(
      this.gateway,
      initResult,
      this.logger,
    );

    return {
      reference: initResult.reference,
      checkoutUrl: initResult.checkoutUrl,
      transfer,
      ...(initResult.gateway === 'paystack'
        ? {
            accessCode: initResult.gatewayTransactionId ?? undefined,
            authorizationUrl: initResult.checkoutUrl,
          }
        : {}),
    };
  }

  async verifyPublicPayment(
    publicToken: string,
    reference: string,
  ): Promise<{
    status: 'success' | 'failed' | 'pending';
    reference: string;
    amount: number;
    paidAt: string | null;
    receiptToken: string | null;
    /** See PaymentVerificationResult.moneyReceived — abandoned vs. in-flight. */
    moneyReceived?: boolean;
  }> {
    const invoice = await this.invoiceRepository.findOne({
      where: { public_token: publicToken },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.covered_by_plan_id) {
      // Covered between initialize and verify (a narrow race — initialize 409s
      // covered invoices). The authoritative webhook path logs the stranded
      // payment for ops; here we just refuse to credit it twice.
      throw new ConflictException(
        'This invoice is being settled through a payment plan. Pay your plan installments instead.',
      );
    }

    const verification =
      await this.gatewayRegistry.verifyByReference(reference);

    if (verification.status !== 'success') {
      if (verification.moneyReceived) {
        // Monnify PARTIALLY_PAID/OVERPAID — real money at the gateway that we
        // deliberately do not credit. Durable ops artifact, not just a log.
        await recordAmountMismatchArtifact(
          this.propertyHistoryRepository,
          this.logger,
          {
            reference: verification.reference,
            amountNaira: verification.amountNaira,
            rawStatus: verification.rawStatus,
            gateway: verification.gateway,
            metadata: verification.metadata,
            lane: 'ad-hoc invoice verify',
            relatedEntityId: invoice.id,
            relatedEntityType: 'ad_hoc_invoice',
            expectedNaira: Math.max(
              0,
              Number(invoice.total_amount) - Number(invoice.amount_paid ?? 0),
            ),
          },
        );
      }
      return {
        status: verification.status,
        reference: verification.reference,
        amount: verification.amountNaira,
        paidAt: null,
        receiptToken: null,
        moneyReceived: verification.moneyReceived,
      };
    }

    if (invoice.status !== AdHocInvoiceStatus.PAID) {
      try {
        await this.markInvoicePaidFromWebhook({
          ...verification,
          metadata: {
            ad_hoc_invoice_id: invoice.id,
            public_token: invoice.public_token,
          },
        });
      } catch (err) {
        this.logger.error(
          `verifyPublicPayment failed to mark paid for ${invoice.id}`,
          (err as Error).stack,
        );
      }
    }

    const fresh = await this.getInvoiceInternal(invoice.id);
    return {
      status: 'success',
      reference: verification.reference,
      amount: Number(fresh.total_amount),
      moneyReceived: true,
      paidAt: fresh.paid_at
        ? fresh.paid_at instanceof Date
          ? fresh.paid_at.toISOString()
          : fresh.paid_at
        : null,
      receiptToken: fresh.receipt_token ?? null,
    };
  }

  async getInvoiceSuccessData(publicToken: string): Promise<{
    invoiceId: string;
    invoiceNumber: string;
    receiptToken: string | null;
    receiptNumber: string | null;
    paidAt: string | null;
    paymentReference: string | null;
    totalAmount: number;
    property: { id: string; name: string };
    tenant: { name: string };
  }> {
    const invoice = await this.invoiceRepository.findOne({
      where: { public_token: publicToken },
      relations: ['property', 'tenant', 'tenant.user'],
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status !== AdHocInvoiceStatus.PAID) {
      throw new NotFoundException('Invoice is not yet paid');
    }

    const tenantUser = invoice.tenant?.user;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : '';

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      receiptToken: invoice.receipt_token ?? null,
      receiptNumber: invoice.receipt_number ?? null,
      paidAt: invoice.paid_at
        ? invoice.paid_at instanceof Date
          ? invoice.paid_at.toISOString()
          : invoice.paid_at
        : null,
      paymentReference: invoice.payment_reference ?? null,
      totalAmount: Number(invoice.total_amount),
      property: {
        id: invoice.property.id,
        name: invoice.property.name,
      },
      tenant: { name: tenantName },
    };
  }

  async getInvoiceReceiptView(receiptToken: string): Promise<any> {
    const invoice = await this.invoiceRepository.findOne({
      where: { receipt_token: receiptToken },
      relations: [
        'line_items',
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!invoice) {
      throw new NotFoundException('Receipt not found');
    }
    if (invoice.status !== AdHocInvoiceStatus.PAID) {
      throw new NotFoundException('Receipt not available — payment required');
    }

    const property = invoice.property;
    const landlordUser = await this.scopeService.resolveBrandingUserForOwner(
      property?.owner_id,
    );
    const landlordBranding = landlordUser?.branding || null;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] || landlordBranding?.letterhead || null;

    const tenantUser = invoice.tenant?.user;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : '';
    const tenantEmail =
      (invoice.tenant as any)?.email ?? tenantUser?.email ?? null;

    const lineItems = (invoice.line_items ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((item) => ({
        id: item.id,
        sequence: item.sequence,
        description: item.description,
        amount: Number(item.amount),
      }));

    return {
      receiptNumber: invoice.receipt_number,
      receiptToken: invoice.receipt_token,
      receiptDate: invoice.paid_at
        ? invoice.paid_at instanceof Date
          ? invoice.paid_at.toISOString()
          : invoice.paid_at
        : null,
      paymentReference: invoice.payment_reference ?? null,
      paymentMethod: invoice.payment_method ?? null,
      amount: Number(invoice.total_amount),
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        totalAmount: Number(invoice.total_amount),
        dueDate: this.formatDate(invoice.due_date),
        notes: invoice.notes,
      },
      lineItems,
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
  // Webhook entry point
  // ───────────────────────────────────────────────────────────────────────

  async markInvoicePaidFromWebhook(
    event: NormalizedPaymentEvent,
  ): Promise<void> {
    const invoiceId = event.metadata?.ad_hoc_invoice_id;
    const publicToken = event.metadata?.public_token;

    let invoice: AdHocInvoice | null = null;
    if (invoiceId) {
      invoice = await this.invoiceRepository.findOne({
        where: { id: invoiceId },
      });
    } else if (publicToken) {
      invoice = await this.invoiceRepository.findOne({
        where: { public_token: publicToken },
      });
    }

    if (!invoice) {
      this.logger.error('Webhook missing ad_hoc_invoice_id / public_token', {
        reference: event.reference,
      });
      throw new Error('Missing ad_hoc_invoice_id in metadata');
    }

    // Covered by a payment plan: the public link should have been locked, but a
    // payment landed anyway (initialize/verify race, or a stale cached link).
    // Never throw — this runs in setImmediate. Log a distinct, queryable event
    // so ops can find the tenant and reconcile; do NOT credit or flip status.
    if (invoice.covered_by_plan_id) {
      this.logger.warn(
        `Online payment received for plan-covered invoice ${invoice.id} (ref: ${event.reference}) — not credited`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'ad_hoc_invoice_payment_on_covered',
          event_description: `Payment received on the public link for invoice ${invoice.invoice_number}, which is being settled by a payment plan — reference ${event.reference}. Funds NOT applied to the invoice; reconcile/refund manually.`,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
          metadata: {
            reference: event.reference,
            amount: event.amountNaira,
            covered_by_plan_id: invoice.covered_by_plan_id,
          },
        }),
      );
      return;
    }

    if (invoice.status === AdHocInvoiceStatus.PAID) {
      // Same reference = the charge that paid this invoice being confirmed
      // again (webhook + redirect-verify race). Only one charge exists, so
      // there is nothing to refund — don't raise an alarm on the timeline.
      if (invoice.payment_reference === event.reference) {
        this.logger.log(
          `Invoice ${invoice.id} already paid by reference ${event.reference} — same charge confirmed twice, ignoring`,
        );
        return;
      }
      this.logger.warn(
        `Duplicate online payment for already-paid invoice ${invoice.id} (ref: ${event.reference})`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'ad_hoc_invoice_duplicate_payment',
          event_description: `Duplicate online payment received for invoice ${invoice.invoice_number} — reference ${event.reference} — refund investigation required`,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
        }),
      );
      return;
    }

    if (invoice.status === AdHocInvoiceStatus.CANCELLED) {
      this.logger.warn(
        `Online payment received for cancelled invoice ${invoice.id} (ref: ${event.reference})`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'ad_hoc_invoice_payment_on_cancelled',
          event_description: `Online payment received for cancelled invoice ${invoice.invoice_number} — reference ${event.reference} — refund investigation required`,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
        }),
      );
      return;
    }

    // Amount sanity guard (100x unit-bug detector): the charge was
    // initialized for exactly the invoice's remaining balance. Underpayment
    // must never mark the invoice PAID — quarantine for ops instead.
    const remaining = Math.max(
      0,
      Number(invoice.total_amount) - Number(invoice.amount_paid ?? 0),
    );
    if (event.amountNaira + 1 < remaining) {
      this.logger.error(
        `Ad-hoc payment ${event.reference}: gateway reports ₦${event.amountNaira.toLocaleString()} but invoice ${invoice.id} expects ₦${remaining.toLocaleString()} — NOT crediting`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'ad_hoc_invoice_amount_mismatch',
          event_description: `Payment of ₦${event.amountNaira.toLocaleString()} (ref ${event.reference}) is LESS than the ₦${remaining.toLocaleString()} due on invoice ${invoice.invoice_number} — not applied; verify on the gateway dashboard and reconcile manually.`,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
          metadata: {
            reference: event.reference,
            received: event.amountNaira,
            expected: remaining,
          },
        }),
      );
      return;
    }
    if (event.amountNaira > remaining + 1) {
      this.logger.warn(
        `Ad-hoc payment ${event.reference}: gateway reports ₦${event.amountNaira.toLocaleString()} — MORE than the ₦${remaining.toLocaleString()} due; crediting the amount due, surplus needs ops reconciliation`,
      );
    }

    await this.markInvoicePaid(invoice, {
      amount: Math.min(event.amountNaira, remaining),
      gatewayRef: event.reference,
      gateway: event.gateway,
      channel: event.channel || undefined,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────

  private async markInvoicePaid(
    invoice: AdHocInvoice,
    args: {
      amount: number;
      gatewayRef: string;
      /** Adapter name that took the money. */
      gateway?: string;
      channel?: string;
      paidAt?: Date;
    },
  ): Promise<void> {
    // Idempotency: webhook and frontend-verify both race to here.
    // Re-read status so the loser doesn't overwrite receipt_token (which is
    // already in the wild via the winner's WhatsApp receipt link).
    const current = await this.invoiceRepository.findOne({
      where: { id: invoice.id },
      select: ['id', 'status'],
    });
    if (!current || current.status === AdHocInvoiceStatus.PAID) {
      this.logger.log(
        `Ad-hoc invoice ${invoice.id} already paid; skipping (idempotent)`,
      );
      return;
    }

    const paidAt = args.paidAt ?? new Date();
    const receiptToken = `receipt_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const receiptNumber = `AHI-R-${Date.now()}`;

    // Race-loser flag: the webhook (setImmediate) and the frontend verify both
    // reach here for the same invoice. The compare-and-swap below ensures only
    // one wins; the loser must NOT credit the wallet a second time.
    let raceLost = false;
    await this.dataSource.transaction(async (manager) => {
      // Compare-and-swap: only flip an invoice that is still unpaid. A second
      // concurrent caller gets affected=0 and credits nothing.
      const claim = await manager.update(
        AdHocInvoice,
        {
          id: invoice.id,
          status: In([AdHocInvoiceStatus.PENDING, AdHocInvoiceStatus.PARTIAL]),
        },
        {
          status: AdHocInvoiceStatus.PAID,
          amount_paid: Number(invoice.total_amount),
          paid_at: paidAt,
          payment_reference: args.gatewayRef,
          payment_method: args.channel ?? null,
          // Which gateway took the money (online-only path).
          payment_gateway: args.gateway ?? 'paystack',
          receipt_token: receiptToken,
          receipt_number: receiptNumber,
        },
      );
      if (!claim.affected) {
        raceLost = true;
        return;
      }

      // Credit the wallet — the tenant has paid the debt we created at invoice-time.
      await this.tenantBalancesService.applyChange(
        invoice.tenant_id,
        invoice.landlord_id,
        args.amount,
        {
          type: TenantBalanceLedgerType.OB_PAYMENT,
          // Channel-first (card / bank_transfer) — this description is a
          // DURABLE wallet-ledger record; never bake a gateway brand into it.
          description: `Invoice ${invoice.invoice_number} paid — ₦${args.amount.toLocaleString()} (${args.channel ?? 'online'})`,
          propertyId: invoice.property_id,
          relatedEntityType: 'ad_hoc_invoice',
          relatedEntityId: invoice.id,
        },
        undefined,
        manager,
      );
    });

    if (raceLost) {
      this.logger.log(
        `Ad-hoc invoice ${invoice.id} already claimed by a concurrent payment; skipping (idempotent)`,
      );
      return;
    }

    const refreshed = await this.getInvoiceInternal(invoice.id);

    await this.logInvoiceEvent(
      'ad_hoc_invoice_paid',
      `Invoice ${invoice.invoice_number} paid — ₦${args.amount.toLocaleString()} (${args.channel ?? 'online'})`,
      refreshed,
      NotificationType.AD_HOC_INVOICE_PAID,
    );

    await this.dispatchInvoicePaidNotifications(refreshed, receiptToken);
  }

  private buildFeeSummary(invoice: AdHocInvoice): string {
    const names = (invoice.line_items ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((li) => li.description.trim())
      .filter(Boolean);
    if (names.length === 0) return invoice.invoice_number;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  private async dispatchInvoiceLinkNotification(
    invoice: AdHocInvoice,
  ): Promise<void> {
    try {
      const property = invoice.property;
      const tenantUser = invoice.tenant?.user;
      const tenantName =
        this.utilService.formatPersonName(
          tenantUser?.first_name,
          tenantUser?.last_name,
        ) || 'there';
      const tenantPhone = tenantUser?.phone_number
        ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
        : null;

      if (!tenantPhone) return;

      await this.whatsappNotificationLog.queue(
        'sendAdhocInvoiceLinkTenant',
        {
          phone_number: tenantPhone,
          tenant_name: tenantName,
          fees: this.utilService.sanitizeTemplateParam(
            this.buildFeeSummary(invoice),
          ),
          public_token: invoice.public_token,
          landlord_id: property?.owner_id,
          property_id: property?.id,
          recipient_name: tenantName,
        },
        invoice.id,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to queue ad-hoc invoice link WhatsApp for ${invoice.id}: ${(err as Error).message}`,
      );
    }
  }

  private async dispatchInvoiceCancelledNotification(
    invoice: AdHocInvoice,
  ): Promise<void> {
    try {
      const property = invoice.property;
      const tenantUser = invoice.tenant?.user;
      const tenantName =
        this.utilService.formatPersonName(
          tenantUser?.first_name,
          tenantUser?.last_name,
        ) || 'there';
      const tenantPhone = tenantUser?.phone_number
        ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
        : null;

      if (!tenantPhone) return;

      await this.whatsappNotificationLog.queue(
        'sendAdhocInvoiceCancelledTenant',
        {
          phone_number: tenantPhone,
          tenant_name: tenantName,
          fees: this.utilService.sanitizeTemplateParam(
            this.buildFeeSummary(invoice),
          ),
          amount: Number(invoice.total_amount),
          landlord_id: property?.owner_id,
          property_id: property?.id,
          recipient_name: tenantName,
        },
        invoice.id,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to queue ad-hoc invoice cancelled WhatsApp for ${invoice.id}: ${(err as Error).message}`,
      );
    }
  }

  private async dispatchInvoicePaidNotifications(
    invoice: AdHocInvoice,
    receiptToken: string,
  ): Promise<void> {
    try {
      const property = invoice.property;
      const tenantUser = invoice.tenant?.user;

      const tenantName =
        this.utilService.formatPersonName(
          tenantUser?.first_name,
          tenantUser?.last_name,
        ) || 'there';

      const tenantPhone = tenantUser?.phone_number
        ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
        : null;

      const amount = Number(invoice.total_amount);
      const fees = this.utilService.sanitizeTemplateParam(
        this.buildFeeSummary(invoice),
      );

      if (tenantPhone) {
        await this.whatsappNotificationLog.queue(
          'sendAdhocInvoicePaidTenant',
          {
            phone_number: tenantPhone,
            tenant_name: tenantName,
            amount,
            charge_name: fees,
            receipt_token: receiptToken,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: tenantName,
          },
          invoice.id,
        );
      }

      const recipients = await this.notificationRecipients.resolveRecipients(
        property?.owner_id,
        NotificationCategory.PAYMENTS,
      );
      for (const [index, recipient] of recipients.entries()) {
        if (!recipient.phone) continue;
        await this.whatsappNotificationLog.queue(
          'sendAdhocInvoicePaidLandlord',
          {
            phone_number: recipient.phone,
            tenant_name: tenantName,
            amount,
            fees,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: recipient.name,
          },
          index === 0 ? invoice.id : `${invoice.id}:${recipient.accountId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to queue WhatsApp paid notifications for invoice ${invoice.id}: ${(err as Error).message}`,
      );
    }
  }

  private async logInvoiceEvent(
    eventType: string,
    description: string,
    invoice: AdHocInvoice,
    notificationType: NotificationType,
  ): Promise<void> {
    try {
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: eventType,
          event_description: description,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
        }),
      );

      const property = invoice.property
        ? invoice.property
        : await this.propertyRepository.findOne({
            where: { id: invoice.property_id },
          });
      const landlordId = property?.owner_id ?? invoice.landlord_id;
      if (!landlordId) return;

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: notificationType,
        description,
        status: 'Completed',
        property_id: invoice.property_id,
        user_id: landlordId,
      });

      const tenantUser = invoice.tenant?.user;
      const tenantName =
        tenantUser?.first_name && tenantUser?.last_name
          ? `${tenantUser.first_name} ${tenantUser.last_name}`
          : '';

      this.eventsGateway.emitHistoryAdded(landlordId, {
        propertyId: invoice.property_id,
        propertyName: property?.name ?? '',
        tenantName,
        displayType: notificationType,
        description,
      });
    } catch (error) {
      this.logger.error(
        `Failed to log invoice event ${eventType} for invoice ${invoice.id}`,
        error,
      );
    }
  }

  private async getInvoiceInternal(id: string): Promise<AdHocInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: [
        'line_items',
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  private async generateInvoiceNumber(
    manager?: EntityManager,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `AHI-${year}-`;
    const repo = manager
      ? manager.getRepository(AdHocInvoice)
      : this.invoiceRepository;
    const last = await repo
      .createQueryBuilder('inv')
      .where('inv.invoice_number LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('inv.invoice_number', 'DESC')
      .getOne();

    let next = 1;
    if (last?.invoice_number) {
      const tail = last.invoice_number.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (!isNaN(parsed)) next = parsed + 1;
    }
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private computeStatus(invoice: AdHocInvoice): AdHocInvoiceStatus {
    // PARTIAL / PAID / CANCELLED pass through unchanged.
    if (invoice.status !== AdHocInvoiceStatus.PENDING) return invoice.status;
    // Covered by a payment plan — suppress OVERDUE so the locked public link
    // doesn't nag the tenant while installments are being collected.
    if (invoice.covered_by_plan_id) return AdHocInvoiceStatus.PENDING;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(invoice.due_date);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate.getTime() < today.getTime()) return AdHocInvoiceStatus.OVERDUE;
    return AdHocInvoiceStatus.PENDING;
  }

  private withComputedStatus(invoice: AdHocInvoice): AdHocInvoice {
    const computed = this.computeStatus(invoice);
    if (computed !== invoice.status) {
      return { ...invoice, status: computed };
    }
    return invoice;
  }

  private formatDate(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value.split('T')[0];
    return value.toISOString().split('T')[0];
  }
}
