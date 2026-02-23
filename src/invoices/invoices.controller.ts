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
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipAuth } from '../auth/auth.decorator';
import { InvoicesService } from './invoices.service';
import { InvoicePDFService } from './invoice-pdf.service';
import { CreateInvoiceDto, UpdateInvoiceDto, InvoiceQueryDto } from './dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RoleGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePDFService: InvoicePDFService,
  ) {}

  /**
   * Get all invoices for landlord
   */
  @Get()
  @Roles('landlord', 'admin')
  async findAll(
    @CurrentUser() user: { id: string; userId: string },
    @Query() query: InvoiceQueryDto,
  ) {
    return this.invoicesService.findAll(user.userId, query);
  }

  /**
   * Get actionable invoices (pending or partially paid)
   */
  @Get('actionable')
  @Roles('landlord', 'admin')
  async findActionable(
    @CurrentUser() user: { id: string; userId: string },
    @Query() query: InvoiceQueryDto,
  ) {
    return this.invoicesService.findActionable(user.userId, query);
  }

  /**
   * Get single invoice by ID
   */
  @Get(':id')
  @Roles('landlord', 'admin')
  async findOne(
    @CurrentUser() user: { id: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.invoicesService.findOne(id, user.userId);
  }

  /**
   * Download invoice as PDF
   */
  @Get(':id/pdf')
  @Roles('landlord', 'admin')
  async downloadPDF(
    @CurrentUser() user: { id: string; userId: string },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.invoicePDFService.generateInvoicePDF(
      id,
      user.userId,
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
  @Roles('landlord', 'admin')
  async create(
    @CurrentUser() user: { id: string; userId: string },
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(user.userId, dto);
  }

  /**
   * Generate invoice from offer letter
   */
  @Post('from-offer/:offerLetterId')
  @Roles('landlord', 'admin')
  async generateFromOfferLetter(
    @CurrentUser() user: { id: string; userId: string },
    @Param('offerLetterId') offerLetterId: string,
  ) {
    return this.invoicesService.generateFromOfferLetter(offerLetterId, user.id);
  }

  /**
   * Update invoice
   */
  @Put(':id')
  @Roles('landlord', 'admin')
  async update(
    @CurrentUser() user: { id: string; userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, user.userId, dto);
  }

  /**
   * Cancel invoice
   */
  @Delete(':id')
  @Roles('landlord', 'admin')
  async cancel(
    @CurrentUser() user: { id: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.invoicesService.cancel(id, user.userId);
  }

  /**
   * Send payment reminder
   */
  @Post(':id/send-reminder')
  @Roles('landlord', 'admin')
  async sendReminder(
    @CurrentUser() user: { id: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.invoicesService.sendReminder(id, user.userId);
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
