import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { RolesEnum } from '../base.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipAuth } from '../auth/auth.decorator';
import { Public } from '../auth/public.decorator';
import { Account } from '../users/entities/account.entity';
import { LandlordOnboardingService } from './landlord-onboarding.service';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import {
  SendOnboardingOtpDto,
  VerifyOnboardingOtpDto,
} from './dto/onboarding-otp.dto';
import { SaveOnboardingDraftDto } from './dto/save-draft.dto';
import {
  OnboardingVerifiedClaims,
  OnboardingVerifiedGuard,
} from './guards/onboarding-verified.guard';

type VerifiedRequest = Request & { onboardingClaims: OnboardingVerifiedClaims };

@Controller('api')
export class LandlordOnboardingController {
  constructor(
    private readonly onboardingService: LandlordOnboardingService,
  ) {}

  // ---- Admin (property manager) ----

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Post('landlord-onboarding/link')
  async generateLink(@CurrentUser() account: Account) {
    const data = await this.onboardingService.generateLink(account.id);
    return { success: true, message: 'Onboarding link generated', data };
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Get('landlord-onboarding/submissions')
  async listSubmissions(
    @CurrentUser() account: Account,
    @Query('search') search?: string,
  ) {
    const submissions = await this.onboardingService.listSubmissions(
      account.id,
      search,
    );
    return { success: true, message: 'Submissions retrieved', data: submissions };
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Get('landlord-onboarding/submissions/:id')
  async getSubmission(
    @CurrentUser() account: Account,
    @Param('id') id: string,
  ) {
    const data = await this.onboardingService.getSubmission(id, account.id);
    return { success: true, message: 'Submission retrieved', data };
  }

  // ---- Public (landlord-facing) ----

  @SkipAuth()
  @Get('landlord-onboarding/upload-signature')
  uploadSignature() {
    return {
      success: true,
      message: 'Upload signature generated',
      data: this.onboardingService.uploadSignature(),
    };
  }

  @SkipAuth()
  @Get('landlord-onboarding/:token/validate')
  async validate(@Param('token') token: string) {
    const data = await this.onboardingService.validateToken(token);
    return {
      success: data.valid,
      message: data.valid
        ? 'Onboarding link is valid'
        : 'This onboarding link is no longer available',
      data,
    };
  }

  @SkipAuth()
  @Post('landlord-onboarding/:token/send-otp')
  async sendOtp(
    @Param('token') token: string,
    @Body(ValidationPipe) dto: SendOnboardingOtpDto,
  ) {
    return this.onboardingService.sendOtp(token, dto.phone);
  }

  @SkipAuth()
  @Post('landlord-onboarding/:token/verify-otp')
  async verifyOtp(
    @Param('token') token: string,
    @Body(ValidationPipe) dto: VerifyOnboardingOtpDto,
  ) {
    return this.onboardingService.verifyOtp(token, dto.phone, dto.otp_code);
  }

  // ---- Draft (phone-verified) ----

  @SkipAuth()
  @UseGuards(OnboardingVerifiedGuard)
  @Put('landlord-onboarding/draft')
  async saveDraft(
    @Req() req: VerifiedRequest,
    @Body(ValidationPipe) dto: SaveOnboardingDraftDto,
  ) {
    const { onboardingToken, phone } = req.onboardingClaims;
    return this.onboardingService.saveDraft(onboardingToken, phone, dto.data);
  }

  @SkipAuth()
  @UseGuards(OnboardingVerifiedGuard)
  @Get('landlord-onboarding/draft')
  async getDraft(@Req() req: VerifiedRequest) {
    const { onboardingToken, phone } = req.onboardingClaims;
    const data = await this.onboardingService.getDraft(onboardingToken, phone);
    return { success: true, message: 'Draft retrieved', data };
  }

  @Public()
  @Post('landlord-onboarding/submit')
  async submit(@Body(ValidationPipe) dto: SubmitOnboardingDto) {
    const data = await this.onboardingService.submit(dto);
    return {
      success: true,
      message: 'Onboarding submission received',
      data,
    };
  }
}
