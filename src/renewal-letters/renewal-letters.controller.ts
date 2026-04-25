import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ValidationPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { RenewalLettersService } from './renewal-letters.service';
import { VerifyAcceptRenewalOtpDto } from './dto/verify-renewal-otp.dto';
import { VerifyRejectRenewalOtpDto } from './dto/verify-reject-renewal-otp.dto';
import {
  RenewalLetterPublicDto,
  InitiateOtpResponseDto,
} from './dto/renewal-letter-public.dto';

/**
 * Tenant-facing renewal-letter routes. All endpoints are public (no
 * authentication) and gated by the opaque token in the URL.
 *
 * Both accept and reject are two-step OTP flows:
 *   POST :token/accept          → send OTP for accept intent
 *   POST :token/accept/verify   → consume OTP, mark accepted
 *   POST :token/reject          → send OTP for reject intent
 *   POST :token/reject/verify   → consume OTP, mark declined
 *
 * Superseded rows return 410 on mutations and `isSuperseded=true` on GET.
 */
@Controller('renewal-letters')
export class RenewalLettersController {
  constructor(
    private readonly renewalLettersService: RenewalLettersService,
  ) {}

  @Public()
  @Get(':token')
  async getLetter(
    @Param('token') token: string,
  ): Promise<RenewalLetterPublicDto> {
    return this.renewalLettersService.getPublicLetter(token);
  }

  @Public()
  @Post(':token/accept')
  async initiateAcceptance(
    @Param('token') token: string,
  ): Promise<InitiateOtpResponseDto> {
    return this.renewalLettersService.initiateAcceptance(token);
  }

  @Public()
  @Post(':token/accept/verify')
  async verifyAcceptance(
    @Param('token') token: string,
    @Body(ValidationPipe) body: VerifyAcceptRenewalOtpDto,
    @Req() req: Request,
  ): Promise<RenewalLetterPublicDto> {
    const ip = body.ipAddress || extractIp(req);
    return this.renewalLettersService.verifyOtpAndAccept(token, body.otp, ip);
  }

  @Public()
  @Post(':token/reject')
  async initiateRejection(
    @Param('token') token: string,
  ): Promise<InitiateOtpResponseDto> {
    return this.renewalLettersService.initiateRejection(token);
  }

  @Public()
  @Post(':token/reject/verify')
  async verifyRejection(
    @Param('token') token: string,
    @Body(ValidationPipe) body: VerifyRejectRenewalOtpDto,
    @Req() req: Request,
  ): Promise<RenewalLetterPublicDto> {
    const ip = body.ipAddress || extractIp(req);
    return this.renewalLettersService.verifyOtpAndReject(
      token,
      body.otp,
      body.reason,
      ip,
    );
  }
}

function extractIp(req: Request): string | undefined {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip
  );
}
