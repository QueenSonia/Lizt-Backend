import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { RolesEnum } from 'src/base.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipAuth } from '../auth/auth.decorator';
import { InvoicesService } from './invoices.service';
import { InvoicePDFService } from './invoice-pdf.service';
import { CreateInvoiceDto, UpdateInvoiceDto, InvoiceQueryDto } from './dto';
import { ManagedScopeInterceptor } from 'src/common/scope/managed-scope.interceptor';
import { ManagedLandlordIds } from 'src/common/scope/managed-landlord-ids.decorator';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RoleGuard)
@UseInterceptors(ManagedScopeInterceptor)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePDFService: InvoicePDFService,
  ) {}

  /**
   * Get all invoices for landlord
   */
  @Get()
  @Roles(RolesEnum.ADMIN)
  async findAll(
    @ManagedLandlordIds() landlordIds: string[],
    @Query() query: InvoiceQueryDto,
  ) {
    return this.invoicesService.findAll(landlordIds, query);
  }

  /**
   * Get actionable invoices (pending or partially paid)
   */
  @Get('actionable')
  @Roles(RolesEnum.ADMIN)
  async findActionable(
    @ManagedLandlordIds() landlordIds: string[],
    @Query() query: InvoiceQueryDto,
  ) {
    return this.invoicesService.findActionable(landlordIds, query);
  }

  /**
   * Get invoice by offer letter ID
   */
  @Get('by-offer/:offerLetterId')
  @Roles(RolesEnum.ADMIN)
  async findByOfferLetterId(@Param('offerLetterId') offerLetterId: string) {
    return this.invoicesService.findByOfferLetterId(offerLetterId);
  }

  /**
   * Get single invoice by ID
   */
  @Get(':id')
  @Roles(RolesEnum.ADMIN)
  async findOne(
    @ManagedLandlordIds() landlordIds: string[],
    @Param('id') id: string,
  ) {
    return this.invoicesService.findOne(id, landlordIds);
  }

  /**
   * Download invoice as PDF
   */
  @Get(':id/pdf')
  @Roles(RolesEnum.ADMIN)
  async downloadPDF(
    @ManagedLandlordIds() landlordIds: string[],
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.invoicePDFService.generateInvoicePDF(
      id,
      landlordIds,
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${id.substring(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  }

  /**
   * Create new invoice
   */
  @Post()
  @Roles(RolesEnum.ADMIN)
  async create(
    @ManagedLandlordIds() landlordIds: string[],
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(dto, landlordIds);
  }

  /**
   * Generate invoice from offer letter
   */
  @Post('from-offer/:offerLetterId')
  @Roles(RolesEnum.ADMIN)
  async generateFromOfferLetter(
    @ManagedLandlordIds() landlordIds: string[],
    @Param('offerLetterId') offerLetterId: string,
  ) {
    return this.invoicesService.generateFromOfferLetter(
      offerLetterId,
      landlordIds,
    );
  }

  /**
   * Update invoice
   */
  @Put(':id')
  @Roles(RolesEnum.ADMIN)
  async update(
    @ManagedLandlordIds() landlordIds: string[],
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, landlordIds, dto);
  }

  /**
   * Cancel invoice
   */
  @Delete(':id')
  @Roles(RolesEnum.ADMIN)
  async cancel(
    @ManagedLandlordIds() landlordIds: string[],
    @Param('id') id: string,
  ) {
    return this.invoicesService.cancel(id, landlordIds);
  }

  /**
   * Send payment reminder
   */
  @Post(':id/send-reminder')
  @Roles(RolesEnum.ADMIN)
  async sendReminder(
    @ManagedLandlordIds() landlordIds: string[],
    @Param('id') id: string,
  ) {
    return this.invoicesService.sendReminder(id, landlordIds);
  }

  /**
   * Track when tenant views an invoice (public endpoint)
   * POST /invoices/public/:token/track-view
   * Requirements: 3.1, 3.2, 3.3, 3.4
   */
  @SkipAuth()
  @Post('public/:token/track-view')
  async trackInvoiceView(
    @Param('token') token: string,
    @Body('ipAddress') ipAddress?: string,
  ) {
    return this.invoicesService.trackInvoiceView(token, ipAddress);
  }
}
