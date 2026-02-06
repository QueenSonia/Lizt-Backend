import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { Property } from '../properties/entities/property.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Users } from '../users/entities/user.entity';
import { CreateInvoiceDto, UpdateInvoiceDto, InvoiceQueryDto } from './dto';
import { TemplateSenderService } from '../whatsapp-bot/template-sender/template-sender.service';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private readonly lineItemRepository: Repository<InvoiceLineItem>,
    @InjectRepository(InvoicePayment)
    private readonly invoicePaymentRepository: Repository<InvoicePayment>,
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly templateSenderService: TemplateSenderService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Generate unique invoice number
   */
  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;

    const lastInvoice = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .where('invoice.invoice_number LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('invoice.invoice_number', 'DESC')
      .getOne();

    let nextNumber = 1;
    if (lastInvoice) {
      const lastNumber = parseInt(
        lastInvoice.invoice_number.replace(prefix, ''),
        10,
      );
      nextNumber = lastNumber + 1;
    }

    return `${prefix}${String(nextNumber).padStart(4, '0')}`;
  }

  /**
   * Transform invoice to response format
   */
  private transformInvoice(invoice: Invoice) {
    const tenantName = invoice.kyc_application
      ? `${invoice.kyc_application.first_name} ${invoice.kyc_application.last_name}`
      : invoice.tenant
        ? `${invoice.tenant.first_name} ${invoice.tenant.last_name}`
        : 'Unknown';

    const tenantEmail =
      invoice.kyc_application?.email || invoice.tenant?.email || '';
    const tenantPhone =
      invoice.kyc_application?.phone_number ||
      invoice.tenant?.phone_number ||
      '';

    const lastPayment =
      invoice.payments?.length > 0
        ? invoice.payments.sort(
            (a, b) =>
              new Date(b.payment_date).getTime() -
              new Date(a.payment_date).getTime(),
          )[0]
        : null;

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      tenantName,
      tenantEmail,
      tenantPhone,
      propertyName: invoice.property?.name || '',
      propertyId: invoice.property_id,
      invoiceDate: invoice.invoice_date,
      status: invoice.status,
      totalAmount: Number(invoice.total_amount),
      amountPaid: Number(invoice.amount_paid),
      outstandingBalance: Number(invoice.outstanding_balance),
      lastPaymentDate: lastPayment?.payment_date || null,
      lineItems:
        invoice.line_items?.map((item) => ({
          description: item.description,
          amount: Number(item.amount),
        })) || [],
      paymentHistory:
        invoice.payments?.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paidAt: p.payment_date,
          reference: p.reference || '',
          paymentMethod: p.payment_method || '',
        })) || [],
    };
  }

  /**
   * Find all invoices for a landlord with filters
   */
  async findAll(landlordId: string, query: InvoiceQueryDto) {
    const { status, search, page = 1, limit = 20 } = query;

    const queryBuilder = this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.property', 'property')
      .leftJoinAndSelect('invoice.kyc_application', 'kyc')
      .leftJoinAndSelect('invoice.tenant', 'tenant')
      .leftJoinAndSelect('invoice.line_items', 'lineItems')
      .leftJoinAndSelect('invoice.payments', 'payments')
      .where('invoice.landlord_id = :landlordId', { landlordId });

    if (status) {
      queryBuilder.andWhere('invoice.status = :status', { status });
    }

    if (search) {
      queryBuilder.andWhere(
        '(kyc.first_name ILIKE :search OR kyc.last_name ILIKE :search OR tenant.first_name ILIKE :search OR tenant.last_name ILIKE :search OR property.name ILIKE :search OR kyc.phone_number ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const total = await queryBuilder.getCount();

    const invoices = await queryBuilder
      .orderBy('invoice.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      invoices: invoices.map((inv) => this.transformInvoice(inv)),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find actionable invoices (pending or partially paid)
   */
  async findActionable(landlordId: string, query: InvoiceQueryDto) {
    const { search, page = 1, limit = 20 } = query;

    const queryBuilder = this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.property', 'property')
      .leftJoinAndSelect('invoice.kyc_application', 'kyc')
      .leftJoinAndSelect('invoice.tenant', 'tenant')
      .leftJoinAndSelect('invoice.line_items', 'lineItems')
      .leftJoinAndSelect('invoice.payments', 'payments')
      .where('invoice.landlord_id = :landlordId', { landlordId })
      .andWhere('invoice.status IN (:...statuses)', {
        statuses: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID],
      });

    if (search) {
      queryBuilder.andWhere(
        '(kyc.first_name ILIKE :search OR kyc.last_name ILIKE :search OR tenant.first_name ILIKE :search OR tenant.last_name ILIKE :search OR property.name ILIKE :search OR kyc.phone_number ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const total = await queryBuilder.getCount();

    const invoices = await queryBuilder
      .orderBy('invoice.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      invoices: invoices.map((inv) => this.transformInvoice(inv)),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find single invoice by ID
   */
  async findOne(id: string, landlordId: string) {
    const invoice = await this.invoiceRepository.findOne({
      where: { id, landlord_id: landlordId },
      relations: [
        'property',
        'kyc_application',
        'tenant',
        'line_items',
        'payments',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const base = this.transformInvoice(invoice);
    return {
      ...base,
      propertyAddress: invoice.property?.location || '',
      notes: invoice.notes,
    };
  }

  /**
   * Create a new invoice
   */
  async create(landlordId: string, dto: CreateInvoiceDto) {
    const property = await this.propertyRepository.findOne({
      where: { id: dto.propertyId, owner_id: landlordId },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    const totalAmount = dto.lineItems.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    if (totalAmount <= 0) {
      throw new BadRequestException('Total amount must be greater than zero');
    }

    const invoiceNumber = await this.generateInvoiceNumber();

    const invoice = await this.dataSource.transaction(async (manager) => {
      const newInvoice = manager.create(Invoice, {
        invoice_number: invoiceNumber,
        landlord_id: landlordId,
        tenant_id: dto.tenantId || undefined,
        kyc_application_id: dto.kycApplicationId || undefined,
        property_id: dto.propertyId,
        total_amount: totalAmount,
        outstanding_balance: totalAmount,
        notes: dto.notes,
        status: InvoiceStatus.PENDING,
      });

      const savedInvoice = await manager.save(Invoice, newInvoice);

      const lineItems = dto.lineItems.map((item) =>
        manager.create(InvoiceLineItem, {
          invoice_id: savedInvoice.id,
          description: item.description,
          amount: item.amount,
        }),
      );

      await manager.save(InvoiceLineItem, lineItems);

      return savedInvoice;
    });

    return this.findOne(invoice.id, landlordId);
  }

  /**
   * Generate invoice from offer letter
   */
  async generateFromOfferLetter(
    offerLetterId: string,
    landlordAccountId: string,
  ) {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { id: offerLetterId, landlord_id: landlordAccountId },
      relations: ['property', 'kyc_application', 'landlord'],
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    // Get the User ID from the Account (landlord_id in offer letter is Account ID)
    // Invoice.landlord_id expects a User ID, not Account ID
    const landlordUserId = offerLetter.landlord?.userId;
    if (!landlordUserId) {
      throw new NotFoundException(
        'Landlord user not found for this offer letter',
      );
    }

    const existingInvoice = await this.invoiceRepository.findOne({
      where: { offer_letter_id: offerLetterId },
    });

    if (existingInvoice) {
      throw new ConflictException(
        'Invoice already exists for this offer letter',
      );
    }

    const lineItems: { description: string; amount: number }[] = [];

    if (offerLetter.rent_amount && Number(offerLetter.rent_amount) > 0) {
      lineItems.push({
        description: 'Annual Rent',
        amount: Number(offerLetter.rent_amount),
      });
    }

    if (offerLetter.service_charge && Number(offerLetter.service_charge) > 0) {
      lineItems.push({
        description: 'Service Charge',
        amount: Number(offerLetter.service_charge),
      });
    }

    if (offerLetter.legal_fee && Number(offerLetter.legal_fee) > 0) {
      lineItems.push({
        description: 'Legal Fee',
        amount: Number(offerLetter.legal_fee),
      });
    }

    if (
      offerLetter.caution_deposit &&
      Number(offerLetter.caution_deposit) > 0
    ) {
      lineItems.push({
        description: 'Caution Deposit',
        amount: Number(offerLetter.caution_deposit),
      });
    }

    if (offerLetter.agency_fee && Number(offerLetter.agency_fee) > 0) {
      lineItems.push({
        description: 'Agency Fee',
        amount: Number(offerLetter.agency_fee),
      });
    }

    const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const invoiceNumber = await this.generateInvoiceNumber();

    const invoice = await this.dataSource.transaction(async (manager) => {
      const newInvoice = manager.create(Invoice, {
        invoice_number: invoiceNumber,
        landlord_id: landlordUserId,
        kyc_application_id: offerLetter.kyc_application_id,
        property_id: offerLetter.property_id,
        offer_letter_id: offerLetterId,
        total_amount: totalAmount,
        amount_paid: Number(offerLetter.amount_paid) || 0,
        outstanding_balance:
          totalAmount - (Number(offerLetter.amount_paid) || 0),
        status:
          Number(offerLetter.amount_paid) > 0
            ? Number(offerLetter.amount_paid) >= totalAmount
              ? InvoiceStatus.PAID
              : InvoiceStatus.PARTIALLY_PAID
            : InvoiceStatus.PENDING,
        notes: `Generated from Offer Letter for ${offerLetter.property?.name || 'Property'}`,
      });

      const savedInvoice = await manager.save(Invoice, newInvoice);

      const invoiceLineItems = lineItems.map((item) =>
        manager.create(InvoiceLineItem, {
          invoice_id: savedInvoice.id,
          description: item.description,
          amount: item.amount,
        }),
      );

      await manager.save(InvoiceLineItem, invoiceLineItems);

      return savedInvoice;
    });

    return this.findOne(invoice.id, landlordUserId);
  }

  /**
   * Update invoice (only before any payment)
   */
  async update(id: string, landlordId: string, dto: UpdateInvoiceDto) {
    const invoice = await this.invoiceRepository.findOne({
      where: { id, landlord_id: landlordId },
      relations: ['payments'],
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.payments?.length > 0) {
      throw new BadRequestException(
        'Cannot update invoice after payments have been made',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      if (dto.lineItems) {
        await manager.delete(InvoiceLineItem, { invoice_id: id });

        const totalAmount = dto.lineItems.reduce(
          (sum, item) => sum + item.amount,
          0,
        );

        const lineItems = dto.lineItems.map((item) =>
          manager.create(InvoiceLineItem, {
            invoice_id: id,
            description: item.description,
            amount: item.amount,
          }),
        );

        await manager.save(InvoiceLineItem, lineItems);

        await manager.update(Invoice, id, {
          total_amount: totalAmount,
          outstanding_balance: totalAmount,
        });
      }

      if (dto.notes !== undefined) {
        await manager.update(Invoice, id, { notes: dto.notes });
      }
    });

    return this.findOne(id, landlordId);
  }

  /**
   * Cancel invoice
   */
  async cancel(id: string, landlordId: string) {
    const invoice = await this.invoiceRepository.findOne({
      where: { id, landlord_id: landlordId },
      relations: ['payments'],
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.payments?.length > 0) {
      throw new BadRequestException(
        'Cannot cancel invoice after payments have been made',
      );
    }

    await this.invoiceRepository.update(id, {
      status: InvoiceStatus.CANCELLED,
    });

    return { success: true, message: 'Invoice cancelled' };
  }

  /**
   * Record a payment against an invoice
   */
  async recordPayment(
    invoiceId: string,
    amount: number,
    paymentMethod: string,
    reference: string,
    paymentId?: string,
  ) {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const invoicePayment = manager.create(InvoicePayment, {
        invoice_id: invoiceId,
        payment_id: paymentId || undefined,
        amount,
        payment_method: paymentMethod,
        reference,
      });

      await manager.save(InvoicePayment, invoicePayment);

      const newAmountPaid = Number(invoice.amount_paid) + amount;
      const newOutstandingBalance =
        Number(invoice.total_amount) - newAmountPaid;

      let newStatus = invoice.status;
      if (newOutstandingBalance <= 0) {
        newStatus = InvoiceStatus.PAID;
      } else if (newAmountPaid > 0) {
        newStatus = InvoiceStatus.PARTIALLY_PAID;
      }

      await manager.update(Invoice, invoiceId, {
        amount_paid: newAmountPaid,
        outstanding_balance: Math.max(0, newOutstandingBalance),
        status: newStatus,
      });
    });
  }

  /**
   * Send payment reminder via WhatsApp
   */
  async sendReminder(id: string, landlordId: string) {
    const invoice = await this.invoiceRepository.findOne({
      where: { id, landlord_id: landlordId },
      relations: ['property', 'kyc_application', 'tenant', 'landlord'],
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid');
    }

    const tenantPhone =
      invoice.kyc_application?.phone_number || invoice.tenant?.phone_number;

    if (!tenantPhone) {
      throw new BadRequestException('Tenant phone number not available');
    }

    const tenantName = invoice.kyc_application
      ? `${invoice.kyc_application.first_name} ${invoice.kyc_application.last_name}`
      : invoice.tenant
        ? `${invoice.tenant.first_name} ${invoice.tenant.last_name}`
        : 'Tenant';

    const landlordName = `${invoice.landlord.first_name} ${invoice.landlord.last_name}`;

    await this.templateSenderService.sendInvoiceReminder({
      phone_number: tenantPhone,
      tenant_name: tenantName,
      landlord_name: landlordName,
      property_name: invoice.property?.name || 'Property',
      invoice_number: invoice.invoice_number,
      outstanding_balance: Number(invoice.outstanding_balance),
    });

    return { success: true, message: 'Payment reminder sent via WhatsApp' };
  }

  /**
   * Find invoice by offer letter ID
   */
  async findByOfferLetterId(offerLetterId: string): Promise<Invoice | null> {
    return this.invoiceRepository.findOne({
      where: { offer_letter_id: offerLetterId },
    });
  }

  /**
   * Record a payment from offer letter payment flow
   * Called by PaymentService when a Paystack payment is successful
   */
  async recordPaymentFromOfferLetter(
    offerLetterId: string,
    amount: number,
    reference: string,
    paymentMethod: string,
    paymentId?: string,
  ): Promise<void> {
    // Find the invoice linked to this offer letter
    const invoice = await this.invoiceRepository.findOne({
      where: { offer_letter_id: offerLetterId },
    });

    if (!invoice) {
      // No invoice exists for this offer letter - this is fine for older offer letters
      return;
    }

    // Record the payment
    await this.recordPayment(
      invoice.id,
      amount,
      paymentMethod,
      reference,
      paymentId,
    );
  }
}
