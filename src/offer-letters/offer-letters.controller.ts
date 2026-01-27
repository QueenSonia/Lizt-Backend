import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  ValidationPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipAuth } from '../auth/auth.decorator';
import { Account } from '../users/entities/account.entity';
import { OfferLettersService } from './offer-letters.service';
import { PDFGeneratorService } from './pdf-generator.service';
import { CreateOfferLetterDto } from './dto/create-offer-letter.dto';
import { VerifyOfferOtpDto } from './dto/verify-otp.dto';
import {
  OfferLetterResponse,
  AcceptanceInitiationResponse,
} from './dto/offer-letter-response.dto';

/**
 * OfferLettersController
 * Handles all offer letter API endpoints
 * Requirements: 10.1-10.7
 */
@Controller('offer-letters')
export class OfferLettersController {
  constructor(
    private readonly offerLettersService: OfferLettersService,
    private readonly pdfGeneratorService: PDFGeneratorService,
  ) { }

  /**
   * Create and send an offer letter
   * POST /offer-letters
   * Requirements: 10.1, 10.8, 10.9
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Post()
  async create(
    @Body(ValidationPipe) createOfferLetterDto: CreateOfferLetterDto,
    @CurrentUser() user: Account,
  ): Promise<OfferLetterResponse> {
    return this.offerLettersService.create(createOfferLetterDto, user.id);
  }

  /**
   * Get offer letter by token (public endpoint)
   * GET /offer-letters/:token
   * Requirements: 10.2
   */
  @SkipAuth()
  @Get(':token')
  async findByToken(
    @Param('token') token: string,
  ): Promise<OfferLetterResponse> {
    return this.offerLettersService.findByToken(token);
  }

  /**
   * Download offer letter as PDF (public endpoint)
   * GET /offer-letters/:token/pdf
   * Requirements: 4.2, 10.3
   */
  @SkipAuth()
  @Get(':token/pdf')
  async downloadPDF(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdfBuffer =
      await this.pdfGeneratorService.generateOfferLetterPDF(token);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="offer-letter-${token.substring(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    return new StreamableFile(pdfBuffer);
  }

  /**
   * Initiate acceptance process (sends OTP)
   * POST /offer-letters/:token/accept
   * Requirements: 9.1, 10.5
   */
  @SkipAuth()
  @Post(':token/accept')
  async initiateAcceptance(
    @Param('token') token: string,
  ): Promise<AcceptanceInitiationResponse> {
    return this.offerLettersService.initiateAcceptance(token);
  }

  /**
   * Verify OTP and complete acceptance
   * POST /offer-letters/:token/verify-otp
   * Requirements: 9.3, 10.6
   */
  @SkipAuth()
  @Post(':token/verify-otp')
  async verifyOTPAndAccept(
    @Param('token') token: string,
    @Body(ValidationPipe) body: VerifyOfferOtpDto,
  ): Promise<OfferLetterResponse> {
    return this.offerLettersService.verifyOTPAndAccept(token, body.otp);
  }

  /**
   * Reject offer letter
   * POST /offer-letters/:token/reject
   * Requirements: 9.6, 10.7
   */
  @SkipAuth()
  @Post(':token/reject')
  async reject(@Param('token') token: string): Promise<OfferLetterResponse> {
    return this.offerLettersService.reject(token);
  }
}
