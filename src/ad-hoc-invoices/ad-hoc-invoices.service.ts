import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  AdHocInvoice,
  AdHocInvoiceStatus,
} from './entities/ad-hoc-invoice.entity';
import { AdHocInvoiceLineItem } from './entities/ad-hoc-invoice-line-item.entity';
import { CreateAdHocInvoiceDto } from './dto/create-ad-hoc-invoice.dto';

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
  ) {}

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
    if (createdByUserId && property.owner_id !== createdByUserId) {
      throw new ForbiddenException(
        'Only the property landlord can issue invoices',
      );
    }

    if (!Array.isArray(dto.lineItems) || dto.lineItems.length < 1) {
      throw new BadRequestException(
        'Invoice must have at least one line item',
      );
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

    const invoiceNumber = await this.generateInvoiceNumber();
    const publicToken = uuidv4().replace(/-/g, '');

    const saved = await this.dataSource.transaction(async (manager) => {
      const invoice = manager.create(AdHocInvoice, {
        invoice_number: invoiceNumber,
        landlord_id: property.owner_id,
        property_id: property.id,
        property_tenant_id: propertyTenant.id,
        tenant_id: propertyTenant.tenant_id,
        public_token: publicToken,
        total_amount: totalAmount,
        status: AdHocInvoiceStatus.PENDING,
        due_date: dueDate,
        notes: dto.notes ?? null,
        created_by_user_id: createdByUserId ?? null,
      });
      const savedInvoice = await manager.save(invoice);

      const lineItems = dto.lineItems.map((item, idx) =>
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
    });

    const fresh = await this.getInvoiceInternal(saved.id);

    await this.logInvoiceEvent(
      'ad_hoc_invoice_created',
      `Invoice ${invoiceNumber} generated — ₦${totalAmount.toLocaleString()} (${dto.lineItems.length} line item${dto.lineItems.length === 1 ? '' : 's'})`,
      fresh,
      NotificationType.AD_HOC_INVOICE_CREATED,
    );

    await this.dispatchInvoiceLinkNotification(fresh);

    return fresh;
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
    if (landlordId && invoice.landlord_id !== landlordId) {
      throw new ForbiddenException('Access denied for this invoice');
    }
    return this.withComputedStatus(invoice);
  }

  async cancelInvoice(id: string, userId?: string): Promise<void> {
    const invoice = await this.getInvoiceInternal(id);
    if (userId && invoice.landlord_id !== userId) {
      throw new ForbiddenException('Only the landlord can cancel this invoice');
    }
    if (invoice.status === AdHocInvoiceStatus.PAID) {
      throw new ConflictException('Cannot cancel a paid invoice');
    }
    if (invoice.status === AdHocInvoiceStatus.CANCELLED) {
      throw new ConflictException('Invoice is already cancelled');
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
    const landlordUser = property?.owner?.user;
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
        status: computedStatus,
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

    const amount = Number(invoice.total_amount);
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
    const landlordUser = property.owner?.user;
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

    if (invoice.status === AdHocInvoiceStatus.PAID) {
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
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────

  private async markInvoicePaid(
    invoice: AdHocInvoice,
    args: { amount: number; paystackRef: string; paidAt?: Date },
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

    await this.dataSource.transaction(async (manager) => {
      await manager.update(AdHocInvoice, invoice.id, {
        status: AdHocInvoiceStatus.PAID,
        paid_at: paidAt,
        payment_reference: args.paystackRef,
        receipt_token: receiptToken,
        receipt_number: receiptNumber,
      });

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
          fees: this.buildFeeSummary(invoice),
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
      const fees = this.buildFeeSummary(invoice);

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

  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `AHI-${year}-`;
    const last = await this.invoiceRepository
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
    if (invoice.status !== AdHocInvoiceStatus.PENDING) return invoice.status;
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

  private formatDate(
    value: Date | string | null | undefined,
  ): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value.split('T')[0];
    return value.toISOString().split('T')[0];
  }
}
