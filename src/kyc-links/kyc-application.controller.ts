import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipAuth } from '../auth/auth.decorator';
import { Public } from '../auth/public.decorator';
import { KYCApplicationService } from './kyc-application.service';
import { CreateKYCApplicationDto } from './dto/create-kyc-application.dto';
import {
  KYCApplication,
  ApplicationStatus,
} from './entities/kyc-application.entity';
import { Account } from '../users/entities/account.entity';
import { CompleteKYCDto } from './dto/complete-kyc.dto';

@Controller('api')
export class KYCApplicationController {
  constructor(private readonly kycApplicationService: KYCApplicationService) {}

  /**
   * Submit KYC application (public endpoint - no authentication required)
   * POST /api/kyc/:token/submit
   * Requirements: 3.1, 3.2, 3.4
   */
  @SkipAuth()
  @Post('kyc/:token/submit')
  async submitKYCApplication(
    @Param('token') token: string,
    @Body(ValidationPipe) createKYCApplicationDto: CreateKYCApplicationDto,
  ): Promise<{
    success: boolean;
    message: string;
    applicationId: string;
    status: ApplicationStatus;
  }> {
    const application = await this.kycApplicationService.submitKYCApplication(
      token,
      createKYCApplicationDto,
    );

    return {
      success: true,
      message: 'KYC application submitted successfully',
      applicationId: application.id,
      status: application.status,
    };
  }

  /**
   * Get KYC applications for a property (landlord only)
   * GET /api/properties/:propertyId/kyc-applications
   * Requirements: 4.1, 4.2, 4.3
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('properties/:propertyId/kyc-applications')
  async getApplicationsByProperty(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: Account,
    @Query('status') status?: ApplicationStatus,
    @Query('sortBy') sortBy?: 'created_at' | 'first_name' | 'status',
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ): Promise<{
    success: boolean;
    applications: any[];
    statistics: {
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    };
  }> {
    const filters = {
      status,
      sortBy,
      sortOrder,
    };

    const [applications, statistics] = await Promise.all([
      this.kycApplicationService.getApplicationsByPropertyWithFilters(
        propertyId,
        user.id,
        filters,
      ),
      this.kycApplicationService.getApplicationStatistics(propertyId, user.id),
    ]);

    return {
      success: true,
      applications,
      statistics,
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
  async getApplicationById(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    application: any;
  }> {
    const application = await this.kycApplicationService.getApplicationById(
      applicationId,
      user.id,
    );

    return {
      success: true,
      application,
    };
  }

  /**
   * Get application statistics for a property (landlord only)
   * GET /api/properties/:propertyId/kyc-applications/statistics
   * Requirements: 4.1, 4.2
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('properties/:propertyId/kyc-applications/statistics')
  async getApplicationStatistics(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    statistics: {
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
      statistics,
    };
  }

  /**
   * Get all KYC applications for the logged-in landlord
   * GET /api/kyc-applications
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('kyc-applications')
  async getAllApplications(@CurrentUser() user: Account): Promise<{
    success: boolean;
    applications: any[];
  }> {
    const applications = await this.kycApplicationService.getAllApplications(
      user.id,
    );

    return {
      success: true,
      applications,
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
  async getApplicationsByTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    applications: any[];
  }> {
    const applications =
      await this.kycApplicationService.getApplicationsByTenant(
        tenantId,
        user.id,
      );

    return {
      success: true,
      applications,
    };
  }

  /**
   * Check for any existing KYC record system-wide by phone number
   * GET /api/kyc/check-existing
   */
  @SkipAuth()
  @Get('kyc/check-existing')
  async checkExistingKYC(
    @Query('phone') phone: string,
    @Query('email') email?: string,
  ): Promise<{
    success: boolean;
    hasExisting: boolean;
    kycData?: any;
    source?: string | null;
  }> {
    // Decode URL-encoded phone number
    const decodedPhone = decodeURIComponent(phone);

    const result = await this.kycApplicationService.checkExistingKYC(
      decodedPhone,
      email,
    );

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Check for pending completion KYC by phone number
   * GET /api/kyc/check-pending
   * Requirements: 4.4
   */
  @SkipAuth()
  @Get('kyc/check-pending')
  async checkPendingCompletion(
    @Query('landlordId', ParseUUIDPipe) landlordId: string,
    @Query('phone') phone: string,
    @Query('email') email?: string,
  ): Promise<{
    success: boolean;
    hasPending: boolean;
    kycData?: any;
    propertyIds?: string[];
  }> {
    // Decode URL-encoded phone number
    const decodedPhone = decodeURIComponent(phone);

    const result = await this.kycApplicationService.checkPendingCompletion(
      landlordId,
      decodedPhone,
      email,
    );

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Complete a pending KYC application
   * PUT /api/kyc/complete-pending/:kycId
   * Requirements: 5.1
   */
  @Public()
  @Put('kyc/complete-pending/:kycId')
  async completePendingKYC(
    @Param('kycId', ParseUUIDPipe) kycId: string,
    @Body(ValidationPipe) completionData: CompleteKYCDto,
  ): Promise<{
    success: boolean;
    message: string;
    application: KYCApplication;
  }> {
    const application = await this.kycApplicationService.completePendingKYC(
      kycId,
      completionData,
    );

    return {
      success: true,
      message: 'KYC application completed successfully',
      application,
    };
  }

  /**
   * Get KYC link token for a specific application (landlord only)
   * GET /api/kyc-applications/:applicationId/kyc-token
   * Used for resending KYC completion links
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('kyc-applications/:applicationId/kyc-token')
  async getKYCTokenForApplication(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    token: string;
  }> {
    const token = await this.kycApplicationService.getKYCTokenForApplication(
      applicationId,
      user.id,
    );

    return {
      success: true,
      token,
    };
  }

  /**
   * Resend KYC completion link for a specific application (landlord only)
   * POST /api/kyc-applications/:applicationId/resend-kyc
   * Uses the same template as initial KYC completion links
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Post('kyc-applications/:applicationId/resend-kyc')
  async resendKYCCompletionLink(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: Account,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.kycApplicationService.resendKYCCompletionLink(
      applicationId,
      user.id,
    );

    return {
      success: true,
      message: 'KYC completion link sent successfully',
    };
  }
}
