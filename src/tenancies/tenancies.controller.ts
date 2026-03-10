import {
  Controller,
  Put,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Req,
  Res,
  HttpStatus,
  HttpException,
  NotFoundException,
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
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { Public } from 'src/auth/public.decorator';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import { RenewTenancyDto } from './dto/renew-tenancy.dto';
import { TenancyVerifyOTPDto } from './dto/verify-otp.dto';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RenewalInvoiceDto } from './dto/renewal-invoice.dto';
import { TenanciesService } from 'src/tenancies/tenancies.service';
import { RenewalOTPService } from './renewal-otp.service';
import { RenewalPaymentService } from './renewal-payment.service';
import { RenewalPDFService } from './renewal-pdf.service';
import { RenewalInvoice } from './entities/renewal-invoice.entity';

@ApiTags('Tenancies')
@Controller('tenancies')
@UseGuards(JwtAuthGuard, RoleGuard)
export class TenanciesController {
  constructor(
    private readonly tenanciesService: TenanciesService,
    private readonly renewalOTPService: RenewalOTPService,
    private readonly renewalPaymentService: RenewalPaymentService,
    private readonly renewalPDFService: RenewalPDFService,
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
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
          link: 'http://localhost:3000/renewal-invoice/verify/123e4567-e89b-12d3-a456-426614174000',
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
  @Post(':propertyTenantId/initiate-renewal')
  async initiateRenewal(
    @Param('propertyTenantId', new ParseUUIDPipe()) propertyTenantId: string,
    @Req() req: any,
  ) {
    const { token, link } = await this.tenanciesService.initiateRenewal(
      propertyTenantId,
      req.user.id,
    );

    return {
      success: true,
      message: 'Renewal link sent successfully',
      data: {
        token,
        link,
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

  /**
   * POST /api/tenancies/renewal-invoice/:token/verify-otp
   * Verify OTP for invoice access
   * Requirements: 3.5, 3.6
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Verify OTP',
    description: 'Verify OTP code for renewal invoice access',
  })
  @ApiParam({
    name: 'token',
    description: 'Renewal invoice token',
    type: 'string',
  })
  @ApiBody({ type: TenancyVerifyOTPDto })
  @ApiOkResponse({
    description: 'OTP verified successfully',
    schema: {
      example: {
        success: true,
        message: 'Verification successful',
        verified: true,
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid OTP or OTP expired',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many attempts',
  })
  @Post('renewal-invoice/:token/verify-otp')
  async verifyOTP(
    @Param('token') token: string,
    @Body() verifyOTPDto: TenancyVerifyOTPDto,
  ) {
    const verified = await this.renewalOTPService.verifyOTP(
      token,
      verifyOTPDto.otp,
    );

    return {
      success: true,
      message: 'Verification successful',
      verified,
    };
  }

  /**
   * POST /api/tenancies/renewal-invoice/:token/resend-otp
   * Resend OTP to tenant
   * Requirements: 3.7
   * Note: This endpoint does NOT require authentication (public access via token)
   */
  @Public()
  @ApiOperation({
    summary: 'Resend OTP',
    description: 'Request a new OTP code',
  })
  @ApiParam({
    name: 'token',
    description: 'Renewal invoice token',
    type: 'string',
  })
  @ApiOkResponse({
    description: 'OTP sent successfully',
    schema: {
      example: {
        success: true,
        message: 'Verification code sent',
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Please wait before requesting a new code',
  })
  @ApiNotFoundResponse({ description: 'Renewal invoice not found' })
  @Post('renewal-invoice/:token/resend-otp')
  async resendOTP(@Param('token') token: string) {
    // Get invoice with only tenant relation to retrieve phone number (optimized query)
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['tenant', 'tenant.user'],
      select: {
        id: true,
        token: true,
        tenant: {
          id: true,
          user: {
            id: true,
            phone_number: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    // Initiate OTP verification (generates, stores, and sends OTP)
    await this.renewalOTPService.initiateOTPVerification(
      token,
      invoice.tenant.user.phone_number,
    );

    return {
      success: true,
      message: 'Verification code sent',
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

    const result = await this.renewalPaymentService.initializePayment(
      token,
      initializePaymentDto.email,
      invoice.totalAmount,
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
}
