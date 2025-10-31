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
import { Account } from '../users/entities/account.entity';

@Controller('api')
export class KYCLinksController {
  constructor(
    private readonly kycLinksService: KYCLinksService,
    private readonly tenantAttachmentService: TenantAttachmentService,
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
}
