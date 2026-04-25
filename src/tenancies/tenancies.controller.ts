import {
  Controller,
  Put,
  Post,
  Patch,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Req,
  Res,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiTags,
  ApiNotFoundResponse,
  ApiParam,
  ApiConflictResponse,
  ApiGoneResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { Public } from 'src/auth/public.decorator';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import { RenewTenancyDto } from './dto/renew-tenancy.dto';
import { InitiateRenewalDto } from './dto/initiate-renewal.dto';
import { UpdateRenewalInvoiceDto } from './dto/update-renewal-invoice.dto';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RenewalInvoiceDto } from './dto/renewal-invoice.dto';
import { RentChangeImpactDto } from './dto/rent-change-impact.dto';
import { TenanciesService } from 'src/tenancies/tenancies.service';
import { RenewalPaymentService } from './renewal-payment.service';
import { RenewalPDFService } from 'src/pdf/renewal-pdf.service';
import { PaymentPlanRequestsService } from '../payment-plans/payment-plan-requests.service';
import { CreatePaymentPlanRequestDto } from '../payment-plans/dto/create-payment-plan-request.dto';

@ApiTags('Tenancies')
@Controller('tenancies')
@UseGuards(JwtAuthGuard, RoleGuard)
export class TenanciesController {
  constructor(
    private readonly tenanciesService: TenanciesService,
    private readonly renewalPaymentService: RenewalPaymentService,
    private readonly renewalPDFService: RenewalPDFService,
    private readonly paymentPlanRequestsService: PaymentPlanRequestsService,
  ) {}

  @ApiOperation({ summary: 'Renew Tenancy' })
  @ApiBody({ type: RenewTenancyDto })
  @ApiOkResponse({ description: 'Tenancy successfully renewed' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiNotFoundResponse({ description: 'Tenancy not found' })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Put(':id/renew')
  async renewTenancy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() renewTenancyDto: RenewTenancyDto,
    @Req() req: any,
  ) {
    return this.tenanciesService.renewTenancy(id, renewTenancyDto, req.user.id);
  }

  /**
   * PATCH /api/tenancies/:propertyTenantId/active-rent
   * Update the active rent record (current tenancy terms)
   */
  @ApiOperation({ summary: 'Update Active Tenancy', description: 'Update rent amount, service charge, and payment frequency on the active rent record' })
  @ApiParam({ name: 'propertyTenantId', description: 'Property tenant relationship ID', type: 'string', format: 'uuid' })
  @ApiOkResponse({ description: 'Active rent updated successfully' })
  @ApiNotFoundResponse({ description: 'Tenancy or active rent not found' })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @ApiBody({ type: UpdateRenewalInvoiceDto })
  @Patch(':propertyTenantId/active-rent')
  async updateActiveTenancy(
    @Param('propertyTenantId', new ParseUUIDPipe()) propertyTenantId: string,
    @Body() body: UpdateRenewalInvoiceDto,
    @Req() req: any,
  ) {
    const result = await this.tenanciesService.updateActiveTenancy(propertyTenantId, req.user.id, body);
    return { success: true, data: result };
  }

  /**
   * POST /api/tenancies/:propertyTenantId/active-rent/preview-update
   * Dry-run an active-rent edit and return downstream-impact issues
   * (stale invoices, reminder replays, payment-plan drift, …) plus the
   * computed new period. No mutations.
   */
  @ApiOperation({
    summary: 'Preview Active Rent Update',
    description:
      'Dry-run a proposed active-rent edit. Returns typed list of downstream issues + computed new period. Does not mutate.',
  })
  @ApiParam({ name: 'propertyTenantId', description: 'Property tenant relationship ID', type: 'string', format: 'uuid' })
  @ApiOkResponse({ description: 'Impact computed', type: RentChangeImpactDto })
  @ApiNotFoundResponse({ description: 'Tenancy or active rent not found' })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @ApiBody({ type: UpdateRenewalInvoiceDto })
  @Post(':propertyTenantId/active-rent/preview-update')
  async previewActiveRentUpdate(
    @Param('propertyTenantId', new ParseUUIDPipe()) propertyTenantId: string,
    @Body() body: UpdateRenewalInvoiceDto,
    @Req() req: any,
  ) {
    const impact = await this.tenanciesService.previewActiveRentUpdate(
      propertyTenantId,
      req.user.id,
      body,
    );
    return { success: true, data: impact };
  }

  /**
   * POST /api/tenancies/:propertyTenantId/renewal/preview
   * Dry-run a renewal initiation and return downstream-impact issues.
   */
  @ApiOperation({
    summary: 'Preview Renewal Initiation',
    description:
      'Dry-run a proposed renewal. Returns typed list of issues + computed next period. Does not mutate.',
  })
  @ApiParam({ name: 'propertyTenantId', description: 'Property tenant relationship ID', type: 'string', format: 'uuid' })
  @ApiOkResponse({ description: 'Impact computed', type: RentChangeImpactDto })
  @ApiNotFoundResponse({ description: 'Tenancy not found' })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @ApiBody({ type: InitiateRenewalDto })
  @Post(':propertyTenantId/renewal/preview')
  async previewRenewal(
    @Param('propertyTenantId', new ParseUUIDPipe()) propertyTenantId: string,
    @Body() body: InitiateRenewalDto,
    @Req() req: any,
  ) {
    const impact = await this.tenanciesService.previewRenewal(
      propertyTenantId,
      req.user.id,
      body,
    );
    return { success: true, data: impact };
  }

  /**
   * POST /api/tenancies/renewal-invoice/by-id/:id/preview
   * Dry-run a renewal-invoice edit and return downstream-impact issues.
   */
  @ApiOperation({
    summary: 'Preview Renewal Invoice Update',
    description:
      'Dry-run a proposed renewal-invoice edit. Returns typed list of issues + computed period. Does not mutate.',
  })
  @ApiParam({ name: 'id', description: 'Renewal invoice UUID', type: 'string' })
  @ApiOkResponse({ description: 'Impact computed', type: RentChangeImpactDto })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @ApiBody({ type: UpdateRenewalInvoiceDto })
  @Post('renewal-invoice/by-id/:id/preview')
  async previewRenewalInvoiceUpdate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRenewalInvoiceDto,
    @Req() req: any,
  ) {
    const impact = await this.tenanciesService.previewRenewalInvoiceUpdate(
      id,
      req.user.id,
      body,
    );
    return { success: true, data: impact };
  }

  /**
   * POST /api/tenancies/:propertyTenantId/initiate-renewal
   * Initiate renewal and send link to tenant
   * Requirements: 1.1, 1.2, 1.3
   */
  @ApiOperation({
    summary: 'Initiate Tenancy Renewal',
    description:
      'Generate renewal invoice link and send to tenant via WhatsApp',
  })
  @ApiParam({
    name: 'propertyTenantId',
    description: 'Property tenant relationship ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Renewal initiated successfully',
    schema: {
      example: {
        success: true,
        message: 'Renewal link sent successfully',
        data: {
          token: '123e4567-e89b-12d3-a456-426614174000',
          link: 'http://localhost:3000/renewal-invoice/123e4567-e89b-12d3-a456-426614174000',
          sentAt: '2025-01-15T10:30:00Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid property tenant ID' })
  @ApiNotFoundResponse({
    description: 'Property tenant relationship not found',
  })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @ApiBody({ type: InitiateRenewalDto })
  @Post(':propertyTenantId/initiate-renewal')
  async initiateRenewal(
    @Param('propertyTenantId', new ParseUUIDPipe()) propertyTenantId: string,
    @Body() body: InitiateRenewalDto,
    @Req() req: any,
  ) {
    const result = await this.tenanciesService.initiateRenewal(
      propertyTenantId,
      req.user.id,
      body,
    );

    return {
      success: true,
      message: body?.silent
        ? 'Renewal letter saved'
        : 'Renewal letter sent successfully',
      data: {
        token: result.token,
        link: result.link,
        activeInvoiceId: result.activeInvoiceId,
        supersededInvoiceId: result.supersededInvoiceId,
        letterStatus: result.letterStatus,
        sentAt: new Date().toISOString(),
      },
    };
  }

  /**
   * GET /api/tenancies/renewal-invoice/by-id/:id
   * Get renewal invoice data by database ID (authenticated, for landlord dashboard)
   */
  @ApiOperation({
    summary: 'Get Renewal Invoice by ID',
    description: 'Retrieve renewal invoice details by database ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Renewal invoice UUID',
    type: 'string',
  })
  @ApiOkResponse({
    description: 'Renewal invoice retrieved successfully',
    type: RenewalInvoiceDto,
  })
  @ApiNotFoundResponse({ description: 'Renewal invoice not found' })
  @Get('renewal-invoice/by-id/:id')
  async getRenewalInvoiceById(@Param('id', ParseUUIDPipe) id: string) {
    const invoice = await this.tenanciesService.getRenewalInvoiceById(id);

    return {
      success: true,
      data: invoice,
    };
  }

  /**
   * PATCH /api/tenancies/renewal-invoice/by-id/:id
   * Update an existing unpaid renewal invoice (landlord edits next-period terms)
   */
  @ApiOperation({
    summary: 'Update Renewal Invoice',
    description: 'Update rent amount, service charge, and payment frequency on an unpaid renewal invoice',
  })
  @ApiParam({ name: 'id', description: 'Renewal invoice UUID', type: 'string' })
  @ApiOkResponse({ description: 'Invoice updated successfully' })
  @ApiBadRequestResponse({ description: 'Invoice already paid or invalid data' })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @ApiBody({ type: UpdateRenewalInvoiceDto })
  @Patch('renewal-invoice/by-id/:id')
  async updateRenewalInvoice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRenewalInvoiceDto,
    @Req() req: any,
  ) {
    const result = await this.tenanciesService.updateRenewalInvoice(id, req.user.id, body);
    return { success: true, data: result };
  }

  /**
   * GET /api/tenancies/renewal-invoice/:token/wallet-history
   * Get wallet ledger history for a renewal invoice (public, by token)
   */
  @Public()
  @ApiOperation({
    summary: 'Get Invoice Wallet History',
    description: 'Retrieve wallet ledger entries for the tenant associated with a renewal invoice',
  })
  @ApiParam({ name: 'token', description: 'Renewal invoice token', type: 'string' })
  @ApiOkResponse({ description: 'Wallet history retrieved successfully' })
  @ApiNotFoundResponse({ description: 'Renewal invoice not found' })
  @Get('renewal-invoice/:token/wallet-history')
  async getInvoiceWalletHistory(@Param('token') token: string) {
    const entries = await this.tenanciesService.getInvoiceWalletHistory(token);
    return { success: true, data: entries };
  }

  /**
   * GET /api/tenancies/renewal-invoice/:token
   * Get renewal invoice data by token
   * Requirements: 4.1-4.7
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Get Renewal Invoice',
    description: 'Retrieve renewal invoice details by token',
  })
  @ApiParam({
    name: 'token',
    description: 'Renewal invoice token',
    type: 'string',
  })
  @ApiOkResponse({
    description: 'Renewal invoice retrieved successfully',
    type: RenewalInvoiceDto,
  })
  @ApiNotFoundResponse({ description: 'Renewal invoice not found' })
  @ApiGoneResponse({ description: 'Renewal link has expired' })
  @Get('renewal-invoice/:token')
  async getRenewalInvoice(@Param('token') token: string) {
    const invoice = await this.tenanciesService.getRenewalInvoice(token);

    return {
      success: true,
      data: invoice,
    };
  }

  @Public()
  @ApiOperation({
    summary: 'Submit a payment plan request (tenant-facing, token-authed)',
  })
  @ApiParam({ name: 'token', description: 'Renewal invoice token' })
  @ApiBody({ type: CreatePaymentPlanRequestDto })
  @ApiOkResponse({ description: 'Payment plan request submitted' })
  @Post('renewal-invoice/:token/payment-plan-request')
  async submitPaymentPlanRequest(
    @Param('token') token: string,
    @Body() dto: CreatePaymentPlanRequestDto,
  ) {
    const request =
      await this.paymentPlanRequestsService.submitFromToken(token, dto);
    return {
      success: true,
      data: {
        id: request.id,
        status: request.status,
        totalAmount: Number(request.total_amount),
        preferredSchedule: request.preferred_schedule,
        tenantNote: request.tenant_note,
      },
    };
  }

  /**
   * POST /api/tenancies/renewal-invoice/:token/initialize-payment
   * Initialize Paystack payment
   * Requirements: 5.1, 5.5
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Initialize Payment',
    description: 'Initialize Paystack payment for renewal invoice',
  })
  @ApiParam({
    name: 'token',
    description: 'Renewal invoice token',
    type: 'string',
  })
  @ApiBody({ type: InitializePaymentDto })
  @ApiOkResponse({
    description: 'Payment initialized successfully',
    schema: {
      example: {
        success: true,
        data: {
          accessCode: 'abc123xyz',
          reference: 'RENEWAL_1234567890_abcd1234',
          authorizationUrl: 'https://checkout.paystack.com/abc123xyz',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid payment amount or invoice already paid',
  })
  @ApiConflictResponse({ description: 'Invoice already paid' })
  @ApiNotFoundResponse({ description: 'Renewal invoice not found' })
  @Post('renewal-invoice/:token/initialize-payment')
  async initializePayment(
    @Param('token') token: string,
    @Body() initializePaymentDto: InitializePaymentDto,
  ) {
    // Get invoice to retrieve amount
    const invoice = await this.tenanciesService.getRenewalInvoice(token);

    // Use DTO amount if provided (flexible payment), otherwise use full invoice total
    const paymentAmount = initializePaymentDto.amount || invoice.totalAmount;

    const result = await this.renewalPaymentService.initializePayment(
      token,
      initializePaymentDto.email,
      paymentAmount,
      initializePaymentDto.paymentOption,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /api/tenancies/renewal-invoice/:token/verify-payment
   * Verify payment status
   * Requirements: 5.3
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Verify Payment',
    description: 'Verify payment status with Paystack',
  })
  @ApiParam({
    name: 'token',
    description: 'Renewal invoice token',
    type: 'string',
  })
  @ApiBody({ type: VerifyPaymentDto })
  @ApiOkResponse({
    description: 'Payment verified successfully',
    schema: {
      example: {
        success: true,
        data: {
          status: 'success',
          reference: 'RENEWAL_1234567890_abcd1234',
          amount: 575000,
          paidAt: '2025-01-15T10:30:00Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Payment verification failed',
  })
  @Post('renewal-invoice/:token/verify-payment')
  async verifyPayment(
    @Param('token') token: string,
    @Body() verifyPaymentDto: VerifyPaymentDto,
  ) {
    const result = await this.renewalPaymentService.verifyPayment(
      verifyPaymentDto.reference,
    );

    // If payment is successful, process it (catch conflict if already processed)
    if (result.status === 'success') {
      try {
        await this.renewalPaymentService.processSuccessfulPayment(
          token,
          result.reference,
          result.amount,
          result.receiptToken,
          result.channel,
        );
      } catch (error) {
        // If already paid (409 Conflict), that's fine — idempotent
        if (error?.status === 409 || error?.getStatus?.() === 409) {
          // Payment already processed, continue normally
        } else {
          throw error;
        }
      }
    }

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /api/tenancies/renewal-invoice/:token/payment-cancelled
   * Log payment cancellation event
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Log Payment Cancelled',
    description: 'Log that the tenant cancelled the payment flow',
  })
  @ApiParam({
    name: 'token',
    description: 'Renewal invoice token',
    type: 'string',
  })
  @ApiOkResponse({ description: 'Cancellation logged' })
  @ApiNotFoundResponse({ description: 'Renewal invoice not found' })
  @Post('renewal-invoice/:token/payment-cancelled')
  async paymentCancelled(@Param('token') token: string) {
    await this.tenanciesService.logRenewalPaymentCancelled(token);
    return { success: true };
  }

  /**
   * GET /api/tenancies/renewal-invoice/:token/download
   * Download PDF invoice
   * Requirements: 9.2-9.5
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Download Invoice PDF',
    description: 'Generate and download renewal invoice PDF',
  })
  @ApiParam({
    name: 'token',
    description: 'Renewal invoice token',
    type: 'string',
  })
  @ApiOkResponse({
    description: 'PDF generated successfully',
    content: {
      'application/pdf': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Renewal invoice not found or not paid',
  })
  @Get('renewal-invoice/:token/download')
  async downloadInvoice(@Param('token') token: string, @Res() res: Response) {
    try {
      // Get invoice to retrieve property name for filename
      const invoice = await this.tenanciesService.getRenewalInvoice(token);

      // Generate PDF
      const pdfBuffer =
        await this.renewalPDFService.generateRenewalInvoicePDF(token);

      // Generate filename
      const filename = this.renewalPDFService.generateFilename(
        invoice.propertyName,
      );

      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', pdfBuffer.length);

      // Send PDF buffer
      res.send(pdfBuffer);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to generate PDF',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /api/tenancies/renewal-receipt/:token
   * Get renewal receipt data by token
   * Requirements: 4.1-4.8, 8.1-8.3
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Get Renewal Receipt',
    description: 'Retrieve renewal receipt details by receipt token',
  })
  @ApiParam({
    name: 'token',
    description: 'Receipt token',
    type: 'string',
  })
  @ApiOkResponse({
    description: 'Receipt retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          receiptNumber: 'RR-1705312200000',
          receiptDate: '2025-01-15T10:30:00Z',
          transactionReference: 'RENEWAL_1705312200000_abcd1234',
          tenantName: 'John Doe',
          tenantEmail: 'john.doe@example.com',
          tenantPhone: '+2348012345678',
          propertyName: 'Sunset Apartments Unit 3B',
          propertyAddress: '123 Main Street, Victoria Island, Lagos',
          charges: {
            rentAmount: 500000,
            serviceCharge: 50000,
            legalFee: 25000,
            otherCharges: 0,
          },
          totalAmount: 575000,
          paymentDate: '2025-01-15T10:30:00Z',
          paymentMethod: 'card',
          landlordBranding: {
            businessName: 'ABC Properties Ltd',
            businessAddress: '456 Business District, Lagos',
            contactPhone: '+2348087654321',
            contactEmail: 'info@abcproperties.com',
          },
          landlordLogoUrl: 'https://example.com/logo.png',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid receipt token' })
  @ApiNotFoundResponse({ description: 'Receipt not found' })
  @ApiGoneResponse({ description: 'Receipt not available - payment required' })
  @Get('renewal-receipt/:token')
  async getRenewalReceipt(@Param('token') token: string) {
    const receiptData =
      await this.tenanciesService.getRenewalReceiptByToken(token);

    return {
      success: true,
      data: receiptData,
    };
  }
  /**
   * Download renewal receipt as PDF
   * Requirements: 6.1, 6.2, 6.3, 6.4
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @Get('renewal-receipt/:token/download')
  async downloadRenewalReceipt(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      // Get receipt data to retrieve property name for filename
      const receiptData =
        await this.tenanciesService.getRenewalReceiptByToken(token);

      // Generate PDF
      const pdfBuffer =
        await this.renewalPDFService.generateRenewalReceiptPDF(token);

      // Generate filename in format "payment-receipt-{propertyName}-{date}.pdf"
      const filename = this.renewalPDFService.generateReceiptFilename(
        receiptData.propertyName,
        new Date(receiptData.paymentDate),
      );

      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', pdfBuffer.length);

      // Send PDF buffer
      res.send(pdfBuffer);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to generate receipt PDF',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /api/tenancies/renewal-invoice/:token/success-data
   * Get payment success page data
   * Requirements: 1.1-1.7
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Get Payment Success Data',
    description: 'Retrieve payment success page data by invoice token',
  })
  @ApiParam({
    name: 'token',
    description: 'Invoice token',
    type: 'string',
  })
  @ApiOkResponse({
    description: 'Success data retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          invoiceToken: '123e4567-e89b-12d3-a456-426614174000',
          receiptToken: 'receipt_1705312200000_abcd1234',
          invoice: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            propertyName: 'Sunset Apartments Unit 3B',
            tenantName: 'John Doe',
            totalAmount: 575000,
            paymentStatus: 'paid',
          },
          paymentReference: 'RENEWAL_1705312200000_abcd1234',
          paidAt: '2025-01-15T10:30:00Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid invoice token' })
  @ApiNotFoundResponse({ description: 'Invoice not found or not paid' })
  @Get('renewal-invoice/:token/success-data')
  async getPaymentSuccessData(@Param('token') token: string) {
    const successData =
      await this.tenanciesService.getPaymentSuccessData(token);

    return {
      success: true,
      data: successData,
    };
  }
}
