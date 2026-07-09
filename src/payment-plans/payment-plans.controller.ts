import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { PaymentPlanTimelineService } from './timeline/payment-plan-timeline.service';
import { InstallmentPDFService } from './installment-pdf.service';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
import { UpdatePaymentPlanDto } from './dto/update-payment-plan.dto';
import { InitializeInstallmentPaymentDto } from './dto/initialize-installment-payment.dto';
import { MarkInstallmentPaidDto } from './dto/mark-installment-paid.dto';
import { VerifyInstallmentPaymentDto } from './dto/verify-installment-payment.dto';
import { Public } from '../auth/public.decorator';

@ApiTags('Payment-Plans')
@Controller('payment-plans')
export class PaymentPlansController {
  constructor(
    private readonly paymentPlansService: PaymentPlansService,
    private readonly paymentPlanTimelineService: PaymentPlanTimelineService,
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
    @Req() req: any,
    @Query('propertyTenantId') propertyTenantId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.paymentPlansService.listPlans(
      req?.user?.id,
      propertyTenantId,
      tenantId,
      propertyId,
    );
  }

  @ApiOperation({
    summary: 'Category-grouped payment-plan timeline for a tenancy',
    description:
      'Returns one row per payment-plan category (OB, Entire Tenancy, Ad-hoc per invoice, Specific Charge per fee), each with a newest-first activity timeline assembled from plans, requests and property history.',
  })
  @ApiQuery({ name: 'propertyTenantId', required: true, type: String })
  @ApiOkResponse({ description: 'Payment-plan timeline rows' })
  @ApiSecurity('access_token')
  @Get('timeline')
  getTimeline(
    @Req() req: any,
    @Query('propertyTenantId') propertyTenantId: string,
  ) {
    return this.paymentPlanTimelineService.getTimeline(
      req?.user?.id,
      propertyTenantId,
    );
  }

  @ApiOperation({ summary: 'Get a payment plan by id' })
  @ApiOkResponse({ description: 'Payment plan' })
  @ApiSecurity('access_token')
  @Get(':id')
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.paymentPlansService.getPlanForRequester(id, req?.user?.id);
  }

  @ApiOperation({ summary: 'Cancel a payment plan' })
  @ApiQuery({
    name: 'sendInvoiceLink',
    required: false,
    type: Boolean,
    description:
      'When true, the tenant is sent the public pay link for every ad-hoc invoice this cancellation re-opens with money still owing.',
  })
  @ApiOkResponse({ description: 'Payment plan cancelled' })
  @ApiSecurity('access_token')
  @Delete(':id')
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
    @Query('sendInvoiceLink') sendInvoiceLink?: string,
  ) {
    await this.paymentPlansService.cancelPlan(id, req?.user?.id, {
      sendInvoiceLink: sendInvoiceLink === 'true' || sendInvoiceLink === '1',
    });
    return { message: 'Payment plan cancelled' };
  }

  @ApiOperation({
    summary: 'Update a payment plan — reschedule unpaid installments',
    description:
      'Replaces the plan\'s unpaid installments with a new schedule. Paid installments are preserved. Plan total is immutable; new installment sum must equal (total − already paid).',
  })
  @ApiBody({ type: UpdatePaymentPlanDto })
  @ApiOkResponse({ description: 'Payment plan updated' })
  @ApiSecurity('access_token')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePaymentPlanDto,
    @Req() req: any,
  ) {
    return this.paymentPlansService.updatePlan(id, dto, req?.user?.id);
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

  @ApiOperation({
    summary: 'Quote the remaining balance to pay a plan off early (public)',
    description:
      'Returns plan total, amount paid, and the remaining lump a tenant would pay to clear the plan now.',
  })
  @ApiOkResponse({ description: 'Payoff quote' })
  @Public()
  @Get(':id/payoff-quote')
  async getPayoffQuote(@Param('id', new ParseUUIDPipe()) id: string) {
    const data = await this.paymentPlansService.getPlanPayoffQuote(id);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Initialize Paystack to pay a whole plan off early (tenant-facing)',
    description:
      'Charges the remaining plan balance in one transaction. On success every open installment is settled and the plan completes — the same settlement path as a normal installment payment, so there is no second payment door to race the installment links.',
  })
  @ApiBody({ type: InitializeInstallmentPaymentDto })
  @ApiOkResponse({ description: 'Paystack initialization result' })
  @Public()
  @Post(':id/initialize-payoff')
  initializePayoff(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: InitializeInstallmentPaymentDto,
  ) {
    return this.paymentPlansService.initializePlanPayoffPayment(id, dto.email);
  }

  @ApiOperation({
    summary: 'Verify a Paystack plan payoff (tenant-facing)',
    description:
      'Verifies the payoff transaction and settles the whole plan if successful. Idempotent with the Paystack webhook.',
  })
  @ApiBody({ type: VerifyInstallmentPaymentDto })
  @ApiOkResponse({ description: 'Verification result' })
  @Public()
  @Post(':id/verify-payoff')
  async verifyPayoff(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyInstallmentPaymentDto,
  ) {
    const result = await this.paymentPlansService.verifyPlanPayoffPayment(
      id,
      dto.reference,
    );
    return { success: true, data: result };
  }
}
