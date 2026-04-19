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

import { PaymentPlansService } from './payment-plans.service';
import { InstallmentPDFService } from './installment-pdf.service';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
import { InitializeInstallmentPaymentDto } from './dto/initialize-installment-payment.dto';
import { MarkInstallmentPaidDto } from './dto/mark-installment-paid.dto';
import { VerifyInstallmentPaymentDto } from './dto/verify-installment-payment.dto';
import { Public } from '../auth/public.decorator';

@ApiTags('Payment-Plans')
@Controller('payment-plans')
export class PaymentPlansController {
  constructor(
    private readonly paymentPlansService: PaymentPlansService,
    private readonly installmentPdfService: InstallmentPDFService,
  ) {}

  @ApiOperation({ summary: 'Create a payment plan' })
  @ApiBody({ type: CreatePaymentPlanDto })
  @ApiCreatedResponse({ description: 'Payment plan created' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  create(@Body() dto: CreatePaymentPlanDto, @Req() req: any) {
    return this.paymentPlansService.createPlan(dto, req?.user?.id);
  }

  @ApiOperation({ summary: 'List payment plans' })
  @ApiQuery({ name: 'propertyTenantId', required: false, type: String })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiOkResponse({ description: 'Payment plans list' })
  @ApiSecurity('access_token')
  @Get()
  list(
    @Query('propertyTenantId') propertyTenantId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.paymentPlansService.listPlans(
      propertyTenantId,
      tenantId,
      propertyId,
    );
  }

  @ApiOperation({ summary: 'Get a payment plan by id' })
  @ApiOkResponse({ description: 'Payment plan' })
  @ApiSecurity('access_token')
  @Get(':id')
  getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.paymentPlansService.getPlan(id);
  }

  @ApiOperation({ summary: 'Cancel a payment plan' })
  @ApiOkResponse({ description: 'Payment plan cancelled' })
  @ApiSecurity('access_token')
  @Delete(':id')
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    await this.paymentPlansService.cancelPlan(id, req?.user?.id);
    return { message: 'Payment plan cancelled' };
  }

  @ApiOperation({
    summary: 'Public view of a single installment (for the tenant pay page)',
    description:
      'Returns installment + plan + property + tenant + landlord branding. Token-less access by UUID.',
  })
  @ApiOkResponse({ description: 'Installment public view' })
  @Public()
  @Get('installments/:id/public')
  getPublicInstallment(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.paymentPlansService.getPublicInstallmentView(id);
  }

  @ApiOperation({
    summary: 'Initialize Paystack for a single installment (tenant-facing)',
  })
  @ApiBody({ type: InitializeInstallmentPaymentDto })
  @ApiOkResponse({ description: 'Paystack initialization result' })
  @Public()
  @Post('installments/:id/initialize-payment')
  initializeInstallmentPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: InitializeInstallmentPaymentDto,
  ) {
    return this.paymentPlansService.initializeInstallmentPayment(
      id,
      dto.email,
    );
  }

  @ApiOperation({
    summary: 'Verify a Paystack installment payment (tenant-facing)',
    description:
      'Verifies a Paystack transaction and marks the installment paid if successful. Idempotent with the Paystack webhook.',
  })
  @ApiBody({ type: VerifyInstallmentPaymentDto })
  @ApiOkResponse({ description: 'Verification result' })
  @Public()
  @Post('installments/:id/verify-payment')
  async verifyInstallmentPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyInstallmentPaymentDto,
  ) {
    const result = await this.paymentPlansService.verifyInstallmentPayment(
      id,
      dto.reference,
    );
    return { success: true, data: result };
  }

  @ApiOperation({
    summary: 'Success-page data for a paid installment (tenant-facing)',
  })
  @ApiOkResponse({ description: 'Installment success data' })
  @Public()
  @Get('installments/:id/success-data')
  async getInstallmentSuccessData(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.paymentPlansService.getInstallmentSuccessData(id);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Download installment invoice PDF (with paid stamp when paid)',
  })
  @ApiOkResponse({
    description: 'PDF stream',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Public()
  @Get('installments/:id/download')
  async downloadInstallmentInvoice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ) {
    try {
      const view = await this.paymentPlansService.getPublicInstallmentView(id);
      const pdf =
        await this.installmentPdfService.generateInstallmentInvoicePDF(id);
      const filename = this.installmentPdfService.generateFilename(
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

  @ApiOperation({
    summary: 'Get installment receipt by token (public)',
  })
  @ApiOkResponse({ description: 'Receipt view' })
  @Public()
  @Get('installments/receipts/:token')
  async getInstallmentReceipt(@Param('token') token: string) {
    const data =
      await this.paymentPlansService.getInstallmentReceiptView(token);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Download installment receipt PDF by token',
  })
  @ApiOkResponse({
    description: 'PDF stream',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Public()
  @Get('installments/receipts/:token/download')
  async downloadInstallmentReceipt(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const view =
        await this.paymentPlansService.getInstallmentReceiptView(token);
      const pdf =
        await this.installmentPdfService.generateInstallmentReceiptPDF(token);
      const filename = this.installmentPdfService.generateReceiptFilename(
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

  @ApiOperation({
    summary: 'Landlord marks an installment paid manually (cash / transfer)',
  })
  @ApiBody({ type: MarkInstallmentPaidDto })
  @ApiOkResponse({ description: 'Installment marked as paid' })
  @ApiSecurity('access_token')
  @Post('installments/:id/mark-paid')
  markInstallmentPaid(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarkInstallmentPaidDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    return this.paymentPlansService.markInstallmentPaidManual(id, dto, userId);
  }
}
