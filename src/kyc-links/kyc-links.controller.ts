import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import {
  KYCLinksService,
  KYCLinkResponse,
  PropertyKYCData,
  WhatsAppResponse,
} from './kyc-links.service';
import { TenantAttachmentService } from './tenant-attachment.service';
import { AttachTenantDto } from './dto/attach-tenant.dto';
import { SendWhatsAppDto } from './dto/send-whatsapp.dto';
import { CreateKYCApplicationDto } from './dto/create-kyc-application.dto';
import { SendOTPDto } from './dto/send-otp.dto';
import { VerifyOTPDto } from './dto/verify-otp.dto';
import { Account } from '../users/entities/account.entity';
import { KYCApplicationService } from './kyc-application.service';

@Controller('api')
export class KYCLinksController {
  constructor(
    private readonly kycLinksService: KYCLinksService,
    private readonly tenantAttachmentService: TenantAttachmentService,
    private readonly kycApplicationService: KYCApplicationService,
  ) {}

  /**
   * Generate KYC link for property (landlord only)
   * POST /api/properties/:propertyId/kyc-link
   * Requirements: 1.1, 1.2, 2.1, 2.2
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Post('properties/:propertyId/kyc-link')
  async generateKYCLink(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
    data: KYCLinkResponse;
  }> {
    const kycLinkResponse = await this.kycLinksService.generateKYCLink(
      propertyId,
      user.id,
    );

    console.log('Backend kycLinkResponse:', kycLinkResponse);

    return {
      success: true,
      message: 'KYC link generated successfully',
      data: kycLinkResponse,
    };
  }

  /**
   * Send KYC link via WhatsApp
   * POST /api/kyc-links/:token/send-whatsapp
   * Requirements: 1.5, 7.2, 7.3
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Post('kyc-links/:token/send-whatsapp')
  async sendKYCLinkViaWhatsApp(
    @Param('token') token: string,
    @Body(ValidationPipe) sendWhatsAppDto: SendWhatsAppDto,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
    data?: any;
  }> {
    // First validate that the token belongs to a property owned by this landlord
    const tokenValidation = await this.kycLinksService.validateKYCToken(token);

    if (!tokenValidation.valid) {
      return {
        success: false,
        message: tokenValidation.error || 'Invalid KYC token',
      };
    }

    // Generate the full KYC link
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const kycLink = `${baseUrl}/kyc/${token}`;

    const propertyName = tokenValidation.propertyInfo?.name || 'Property';

    const whatsAppResponse = await this.kycLinksService.sendKYCLinkViaWhatsApp(
      sendWhatsAppDto.phoneNumber,
      kycLink,
      propertyName,
    );

    return {
      success: whatsAppResponse.success,
      message: whatsAppResponse.message,
      data: whatsAppResponse.errorCode
        ? {
            errorCode: whatsAppResponse.errorCode,
            retryAfter: whatsAppResponse.retryAfter,
          }
        : undefined,
    };
  }

  /**
   * Validate KYC token and get property information (public endpoint)
   * GET /api/kyc/:token/validate
   * Requirements: 2.4, 2.5, 3.5
   */
  @Public()
  @Get('kyc/:token/validate')
  async validateKYCToken(@Param('token') token: string): Promise<{
    success: boolean;
    message: string;
    data?: PropertyKYCData;
  }> {
    const validationResult = await this.kycLinksService.validateKYCToken(token);

    if (!validationResult.valid) {
      return {
        success: false,
        message: validationResult.error || 'Invalid KYC token',
      };
    }

    return {
      success: true,
      message: 'KYC token is valid',
      data: validationResult,
    };
  }

  /**
   * Send OTP to phone number for KYC verification (public endpoint)
   * POST /api/kyc/:token/send-otp
   * Requirements: Phone verification for KYC applications
   */
  @Public()
  @Post('kyc/:token/send-otp')
  async sendOTPForKYC(
    @Param('token') token: string,
    @Body(ValidationPipe) sendOTPDto: SendOTPDto,
  ): Promise<{
    success: boolean;
    message: string;
    expiresAt?: Date;
  }> {
    try {
      const result = await this.kycLinksService.sendOTPForKYC(
        token,
        sendOTPDto.phoneNumber,
      );

      return result;
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to send OTP',
      };
    }
  }

  /**
   * Verify OTP code for KYC (public endpoint)
   * POST /api/kyc/:token/verify-otp
   * Requirements: Phone verification for KYC applications
   */
  @Public()
  @Post('kyc/:token/verify-otp')
  async verifyOTPForKYC(
    @Param('token') token: string,
    @Body(ValidationPipe) verifyOTPDto: VerifyOTPDto,
  ): Promise<{
    success: boolean;
    message: string;
    verified?: boolean;
  }> {
    try {
      const result = await this.kycLinksService.verifyOTPForKYC(
        token,
        verifyOTPDto.phoneNumber,
        verifyOTPDto.otpCode,
      );

      return result;
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to verify OTP',
      };
    }
  }

  /**
   * Submit KYC application (public endpoint)
   * POST /api/kyc/:token/submit
   * Requirements: 3.1, 3.2, 3.4
   */
  @Public()
  @Post('kyc/:token/submit')
  async submitKYCApplication(
    @Param('token') token: string,
    @Body(ValidationPipe) kycData: CreateKYCApplicationDto,
  ): Promise<{
    success: boolean;
    message: string;
    data?: {
      applicationId: string;
      status: string;
    };
  }> {
    try {
      const application = await this.kycApplicationService.submitKYCApplication(
        token,
        kycData,
      );

      return {
        success: true,
        message: 'KYC application submitted successfully',
        data: {
          applicationId: application.id,
          status: application.status,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to submit KYC application',
      };
    }
  }

  /**
   * Get KYC applications for a property (landlord only)
   * GET /api/properties/:propertyId/kyc-applications
   * Requirements: 4.1, 4.2, 4.3
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('properties/:propertyId/kyc-applications')
  async getKYCApplicationsByProperty(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
    applications: any[];
  }> {
    const applications =
      await this.kycApplicationService.getApplicationsByProperty(
        propertyId,
        user.id,
      );

    return {
      success: true,
      message: 'KYC applications retrieved successfully',
      applications,
    };
  }

  /**
   * Get KYC application statistics for a property (landlord only)
   * GET /api/properties/:propertyId/kyc-applications/statistics
   * Requirements: 4.1, 4.2
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('properties/:propertyId/kyc-applications/statistics')
  async getKYCApplicationStatistics(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    };
  }> {
    const statistics =
      await this.kycApplicationService.getApplicationStatistics(
        propertyId,
        user.id,
      );

    return {
      success: true,
      message: 'KYC application statistics retrieved successfully',
      data: statistics,
    };
  }

  /**
   * Get a specific KYC application by ID (landlord only)
   * GET /api/kyc-applications/:applicationId
   * Requirements: 4.1, 4.2, 4.3
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('kyc-applications/:applicationId')
  async getKYCApplicationById(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    const application = await this.kycApplicationService.getApplicationById(
      applicationId,
      user.id,
    );

    return {
      success: true,
      message: 'KYC application retrieved successfully',
      data: application,
    };
  }

  /**
   * Get KYC applications by tenant ID (landlord only)
   * GET /api/tenants/:tenantId/kyc-applications
   * Requirements: 4.5, 6.4
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('tenants/:tenantId/kyc-applications')
  async getKYCApplicationsByTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
    applications: any[];
  }> {
    const applications =
      await this.kycApplicationService.getApplicationsByTenant(
        tenantId,
        user.id,
      );

    return {
      success: true,
      message: 'Tenant KYC applications retrieved successfully',
      applications,
    };
  }

  /**
   * Attach tenant to property from KYC application (landlord only)
   * POST /api/kyc-applications/:applicationId/attach
   * Requirements: 5.1, 5.2, 5.4, 5.5
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Post('kyc-applications/:applicationId/attach')
  async attachTenantToProperty(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body(ValidationPipe) attachTenantDto: AttachTenantDto,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      tenantId: string;
      propertyId: string;
    };
  }> {
    const result = await this.tenantAttachmentService.attachTenantToProperty(
      applicationId,
      attachTenantDto,
      user.id,
    );

    return {
      success: result.success,
      message: result.message,
      data: {
        tenantId: result.tenantId,
        propertyId: result.propertyId,
      },
    };
  }

  /**
   * Fix existing data inconsistencies - admin endpoint for cleaning up orphaned records
   * This should be called once to clean up existing data issues
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('admin', 'landlord')
  @Post('fix-data-inconsistencies')
  async fixDataInconsistencies(@CurrentUser() user: Account): Promise<{
    success: boolean;
    message: string;
    data: {
      cleanedUpTenants: number;
      cleanedUpProperties: number;
    };
  }> {
    console.log(`Data cleanup requested by user: ${user.id} (${user.role})`);

    const result =
      await this.tenantAttachmentService.fixExistingDataInconsistencies();

    return {
      success: result.success,
      message: result.message,
      data: {
        cleanedUpTenants: result.cleanedUpTenants,
        cleanedUpProperties: result.cleanedUpProperties,
      },
    };
  }
}
