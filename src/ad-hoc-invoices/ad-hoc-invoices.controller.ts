import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { AdHocInvoicesService } from './ad-hoc-invoices.service';
import { AdHocInvoicePdfService } from './ad-hoc-invoice-pdf.service';
import { CreateAdHocInvoiceDto } from './dto/create-ad-hoc-invoice.dto';
import { InitializeAdHocInvoicePaymentDto } from './dto/initialize-ad-hoc-invoice-payment.dto';
import { VerifyAdHocInvoicePaymentDto } from './dto/verify-ad-hoc-invoice-payment.dto';
import { Public } from '../auth/public.decorator';

@ApiTags('Ad-Hoc-Invoices')
@Controller('ad-hoc-invoices')
export class AdHocInvoicesController {
  constructor(
    private readonly adHocInvoicesService: AdHocInvoicesService,
    private readonly adHocInvoicePdfService: AdHocInvoicePdfService,
  ) {}

  @ApiOperation({ summary: 'Create an ad-hoc invoice for a tenancy' })
  @ApiBody({ type: CreateAdHocInvoiceDto })
  @ApiCreatedResponse({ description: 'Invoice created' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  create(@Body() dto: CreateAdHocInvoiceDto, @Req() req: any) {
    return this.adHocInvoicesService.createInvoice(dto, req?.user?.id);
  }

  @ApiOperation({ summary: 'List ad-hoc invoices for a tenancy' })
  @ApiQuery({ name: 'propertyTenantId', required: true, type: String })
  @ApiOkResponse({ description: 'Invoices list' })
  @ApiSecurity('access_token')
  @Get()
  list(@Query('propertyTenantId') propertyTenantId: string) {
    return this.adHocInvoicesService.listInvoicesForTenancy(propertyTenantId);
  }

  @ApiOperation({ summary: 'Get an ad-hoc invoice by id (landlord)' })
  @ApiOkResponse({ description: 'Invoice' })
  @ApiSecurity('access_token')
  @Get(':id')
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.adHocInvoicesService.getInvoice(id, req?.user?.id);
  }

  @ApiOperation({ summary: 'Cancel an ad-hoc invoice' })
  @ApiOkResponse({ description: 'Invoice cancelled' })
  @ApiSecurity('access_token')
  @Delete(':id')
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    await this.adHocInvoicesService.cancelInvoice(id, req?.user?.id);
    return { message: 'Invoice cancelled' };
  }

  @ApiOperation({
    summary: 'Public view of an ad-hoc invoice (for the tenant pay page)',
    description:
      'Returns invoice + line items + property + tenant + landlord branding. Token-less access by public_token.',
  })
  @ApiOkResponse({ description: 'Invoice public view' })
  @Public()
  @Get('public/:token')
  getPublicInvoice(@Param('token') token: string) {
    return this.adHocInvoicesService.getPublicInvoiceView(token);
  }

  @ApiOperation({
    summary: 'Initialize Paystack for an ad-hoc invoice (tenant-facing)',
  })
  @ApiBody({ type: InitializeAdHocInvoicePaymentDto })
  @ApiOkResponse({ description: 'Paystack initialization result' })
  @Public()
  @Post('public/:token/initialize-payment')
  initializePayment(
    @Param('token') token: string,
    @Body() dto: InitializeAdHocInvoicePaymentDto,
  ) {
    return this.adHocInvoicesService.initializePublicPayment(token, dto.email);
  }

  @ApiOperation({
    summary: 'Verify a Paystack ad-hoc invoice payment (tenant-facing)',
    description:
      'Verifies a Paystack transaction and marks the invoice paid if successful. Idempotent with the Paystack webhook.',
  })
  @ApiBody({ type: VerifyAdHocInvoicePaymentDto })
  @ApiOkResponse({ description: 'Verification result' })
  @Public()
  @Post('public/:token/verify-payment')
  async verifyPayment(
    @Param('token') token: string,
    @Body() dto: VerifyAdHocInvoicePaymentDto,
  ) {
    const result = await this.adHocInvoicesService.verifyPublicPayment(
      token,
      dto.reference,
    );
    return { success: true, data: result };
  }

  @ApiOperation({
    summary: 'Success-page data for a paid ad-hoc invoice (tenant-facing)',
  })
  @ApiOkResponse({ description: 'Invoice success data' })
  @Public()
  @Get('public/:token/success-data')
  async getSuccessData(@Param('token') token: string) {
    const data = await this.adHocInvoicesService.getInvoiceSuccessData(token);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Download ad-hoc invoice PDF (with paid stamp when paid)',
  })
  @ApiOkResponse({
    description: 'PDF stream',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Public()
  @Get('public/:token/download')
  async downloadInvoice(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const view =
        await this.adHocInvoicesService.getPublicInvoiceView(token);
      const pdf = await this.adHocInvoicePdfService.generateInvoicePDF(token);
      const filename = this.adHocInvoicePdfService.generateFilename(
        view.property?.name,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to generate PDF',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Get ad-hoc invoice receipt by token (public)' })
  @ApiOkResponse({ description: 'Receipt view' })
  @Public()
  @Get('receipts/:token')
  async getReceipt(@Param('token') token: string) {
    const data = await this.adHocInvoicesService.getInvoiceReceiptView(token);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Download ad-hoc invoice receipt PDF by token' })
  @ApiOkResponse({
    description: 'PDF stream',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Public()
  @Get('receipts/:token/download')
  async downloadReceipt(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const view =
        await this.adHocInvoicesService.getInvoiceReceiptView(token);
      const pdf = await this.adHocInvoicePdfService.generateReceiptPDF(token);
      const filename = this.adHocInvoicePdfService.generateReceiptFilename(
        view.property?.name,
        view.receiptDate ? new Date(view.receiptDate) : new Date(),
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to generate receipt PDF',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
