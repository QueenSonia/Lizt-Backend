import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { PaystackService } from '../payments/paystack.service';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../utils/utility-service';
import { ManagementScopeService } from '../common/scope/management-scope.service';

export interface AdHocInvoiceInitializationResult {
  accessCode: string;
  reference: string;
  authorizationUrl: string;
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
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    private readonly paystackService: PaystackService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly utilService: UtilService,
    private readonly scopeService: ManagementScopeService,
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

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        publicToken: invoice.public_token,
        totalAmount: Number(invoice.total_amount),
        amountPaid: Number(invoice.amount_paid ?? 0),
        status: computedStatus,
        coveredByPlan: !!invoice.covered_by_plan_id,
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

    const paystackResponse = await this.paystackService.initializeTransaction({
      email,
      amount: Math.round(amount * 100),
      reference,
      callback_url: `${process.env.FRONTEND_URL}/pay-invoice/${invoice.public_token}/success`,
      metadata: {
        ad_hoc_invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        public_token: invoice.public_token,
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
      },
      channels: ['card', 'bank_transfer'],
    });

    this.logger.log(
      `Paystack initialized for invoice ${invoice.id}, reference: ${reference}`,
    );

    return {
      accessCode: paystackResponse.data.access_code,
      reference,
      authorizationUrl: paystackResponse.data.authorization_url,
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

    if (invoice.status !== AdHocInvoiceStatus.PAID) {
      try {
        await this.markInvoicePaidFromWebhook({
          reference: data.reference,
          amount: data.amount,
          channel: data.channel,
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
      reference: data.reference,
      amount: Number(fresh.total_amount),
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

  async markInvoicePaidFromWebhook(data: {
    reference: string;
    amount: number;
    channel?: string;
    metadata?: { ad_hoc_invoice_id?: string; public_token?: string };
  }): Promise<void> {
    const invoiceId = data.metadata?.ad_hoc_invoice_id;
    const publicToken = data.metadata?.public_token;

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
        reference: data.reference,
      });
      throw new Error('Missing ad_hoc_invoice_id in metadata');
    }

    // Covered by a payment plan: the public link should have been locked, but a
    // payment landed anyway (initialize/verify race, or a stale cached link).
    // Never throw — this runs in setImmediate. Log a distinct, queryable event
    // so ops can find the tenant and reconcile; do NOT credit or flip status.
    if (invoice.covered_by_plan_id) {
      this.logger.warn(
        `Paystack payment received for plan-covered invoice ${invoice.id} (ref: ${data.reference}) — not credited`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'ad_hoc_invoice_payment_on_covered',
          event_description: `Payment received on the public link for invoice ${invoice.invoice_number}, which is being settled by a payment plan — reference ${data.reference}. Funds NOT applied to the invoice; reconcile/refund manually.`,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
          metadata: {
            reference: data.reference,
            amount: data.amount / 100,
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
      if (invoice.payment_reference === data.reference) {
        this.logger.log(
          `Invoice ${invoice.id} already paid by reference ${data.reference} — same charge confirmed twice, ignoring`,
        );
        return;
      }
      this.logger.warn(
        `Duplicate Paystack payment for already-paid invoice ${invoice.id} (ref: ${data.reference})`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'ad_hoc_invoice_duplicate_payment',
          event_description: `Duplicate Paystack payment received for invoice ${invoice.invoice_number} — reference ${data.reference} — refund investigation required`,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
        }),
      );
      return;
    }

    if (invoice.status === AdHocInvoiceStatus.CANCELLED) {
      this.logger.warn(
        `Paystack payment received for cancelled invoice ${invoice.id} (ref: ${data.reference})`,
      );
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'ad_hoc_invoice_payment_on_cancelled',
          event_description: `Paystack payment received for cancelled invoice ${invoice.invoice_number} — reference ${data.reference} — refund investigation required`,
          related_entity_id: invoice.id,
          related_entity_type: 'ad_hoc_invoice',
        }),
      );
      return;
    }

    const amountInNaira = data.amount / 100;
    await this.markInvoicePaid(invoice, {
      amount: amountInNaira,
      paystackRef: data.reference,
      channel: data.channel ?? undefined,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────

  private async markInvoicePaid(
    invoice: AdHocInvoice,
    args: {
      amount: number;
      paystackRef: string;
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
          payment_reference: args.paystackRef,
          payment_method: args.channel ?? null,
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
          description: `Invoice ${invoice.invoice_number} paid — ₦${args.amount.toLocaleString()} (paystack)`,
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
      `Invoice ${invoice.invoice_number} paid — ₦${args.amount.toLocaleString()} (paystack)`,
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
        `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
        'there';
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
        `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
        'there';
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
      const landlordAccount = property?.owner;
      const landlordUser = landlordAccount?.user;
      const tenantUser = invoice.tenant?.user;

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

      const amount = Number(invoice.total_amount);
      const fees = this.utilService.sanitizeTemplateParam(
        this.buildFeeSummary(invoice),
      );

      if (tenantPhone) {
        await this.whatsappNotificationLog.queue(
          'sendAdhocInvoicePaidTenant',
          {
            phone_number: tenantPhone,
            amount,
            receipt_token: receiptToken,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: tenantName,
          },
          invoice.id,
        );
      }

      if (landlordPhone) {
        await this.whatsappNotificationLog.queue(
          'sendAdhocInvoicePaidLandlord',
          {
            phone_number: landlordPhone,
            tenant_name: tenantName,
            amount,
            fees,
            landlord_id: property?.owner_id,
            property_id: property?.id,
            recipient_name: landlordName,
          },
          invoice.id,
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
      return { ...invoice, status: computed } as AdHocInvoice;
    }
    return invoice;
  }

  private formatDate(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value.split('T')[0];
    return value.toISOString().split('T')[0];
  }
}
