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
import { VerifyRenewalOtpDto } from './dto/verify-renewal-otp.dto';
import { RejectRenewalLetterDto } from './dto/reject-renewal-letter.dto';
import {
  RenewalLetterPublicDto,
  InitiateAcceptanceResponseDto,
} from './dto/renewal-letter-public.dto';

/**
 * Tenant-facing renewal-letter routes. All endpoints are public (no
 * authentication) and gated by the opaque token in the URL.
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
  ): Promise<InitiateAcceptanceResponseDto> {
    return this.renewalLettersService.initiateAcceptance(token);
  }

  @Public()
  @Post(':token/verify-otp')
  async verifyOtp(
    @Param('token') token: string,
    @Body(ValidationPipe) body: VerifyRenewalOtpDto,
    @Req() req: Request,
  ): Promise<RenewalLetterPublicDto> {
    const ip =
      body.ipAddress ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip;
    return this.renewalLettersService.verifyOtpAndAccept(token, body.otp, ip);
  }

  @Public()
  @Post(':token/reject')
  async reject(
    @Param('token') token: string,
    @Body(ValidationPipe) body: RejectRenewalLetterDto,
    @Req() req: Request,
  ): Promise<RenewalLetterPublicDto> {
    const ip =
      body.ipAddress ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip;
    return this.renewalLettersService.reject(token, body.reason, ip);
  }
}
