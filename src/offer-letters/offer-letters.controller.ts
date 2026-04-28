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
  NotFoundException,
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
import { PaymentService } from '../payments/payment.service';
import { CreateOfferLetterDto } from './dto/create-offer-letter.dto';
import { VerifyOfferOtpDto } from './dto/verify-otp.dto';
import { InitiatePaymentDto } from '../payments/dto/initiate-payment.dto';
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
    private readonly paymentService: PaymentService,
  ) {}

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
   * Send offer letter notification via WhatsApp
   * POST /offer-letters/:id/send
   * Requirements: 7.1, 7.2
   */
  @Post(':id/send')
  async sendOfferLetter(
    @Param('id') id: string,
    @CurrentUser() user: Account,
  ): Promise<{ success: boolean; message: string }> {
    await this.offerLettersService.sendOfferLetterById(id, user.id);
    return {
      success: true,
      message: 'Offer letter sent successfully',
    };
  }

  /**
   * Check if offer letter exists for KYC application and property
   * GET /offer-letters/check/:kycApplicationId/:propertyId
   * Returns the existing offer letter if found, or null
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('check/:kycApplicationId/:propertyId')
  async checkExistingOffer(
    @Param('kycApplicationId') kycApplicationId: string,
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: Account,
  ): Promise<OfferLetterResponse | null> {
    return this.offerLettersService.findByKycApplicationAndProperty(
      kycApplicationId,
      propertyId,
      user.id,
    );
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
   * Track when tenant opens/views the offer letter
   * POST /offer-letters/:token/track-open
   * Public endpoint - no authentication required
   */
  @SkipAuth()
  @Post(':token/track-open')
  async trackOfferOpen(
    @Param('token') token: string,
    @Body('ipAddress') ipAddress?: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    return await this.offerLettersService.trackOfferOpen(token, ipAddress);
  }

  /**
   * Download offer letter as PDF (public endpoint)
   * GET /offer-letters/:token/pdf
   * Requirements: 4.2, 10.3
   * OPTIMIZED: Uses cached PDF if available and recent
   */
  @SkipAuth()
  @Get(':token/pdf')
  async downloadPDF(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<any> {
    const offerLetter =
      await this.offerLettersService.getOfferLetterByToken(token);

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    // OPTIMIZATION: Check if cached PDF exists and is recent (within 24
    // hours) AND post-dates the most recent status change. The latter is
    // critical — `generatePDFInBackground` only fires on create/update, so
    // a tenant who accepts within 24h of the original render would
    // otherwise be served a stale PENDING PDF (no ACCEPTED stamp). Bump
    // the cache invariant to also check decision_made_at and sent_at.
    if (offerLetter.pdf_url && offerLetter.pdf_generated_at) {
      const generatedAt = new Date(offerLetter.pdf_generated_at).getTime();
      const hoursSinceGeneration = (Date.now() - generatedAt) / (1000 * 60 * 60);
      const latestEvent = Math.max(
        offerLetter.decision_made_at
          ? new Date(offerLetter.decision_made_at).getTime()
          : 0,
        offerLetter.sent_at
          ? new Date(offerLetter.sent_at).getTime()
          : 0,
        offerLetter.accepted_at
          ? new Date(offerLetter.accepted_at).getTime()
          : 0,
      );
      const cacheCoversLatestEvent = generatedAt >= latestEvent;

      if (hoursSinceGeneration < 24 && cacheCoversLatestEvent) {
        try {
          // Verify URL is accessible
          const response = await fetch(offerLetter.pdf_url, {
            method: 'HEAD',
          });
          if (response.ok) {
            // Redirect to cached PDF (instant response!)
            return res.redirect(offerLetter.pdf_url);
          }
        } catch (error) {
          // If URL check fails, fall through to regenerate
          console.log('Cached PDF not accessible, regenerating...');
        }
      }
    }

    // Generate new PDF if cache is stale or doesn't exist
    const pdfBuffer =
      await this.pdfGeneratorService.generateOfferLetterPDF(token);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="offer-letter-${token.substring(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
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
    return this.offerLettersService.verifyOTPAndAccept(
      token,
      body.otp,
      body.ipAddress,
    );
  }

  /**
   * Reject offer letter
   * POST /offer-letters/:token/reject
   * Requirements: 9.6, 10.7
   */
  @SkipAuth()
  @Post(':token/reject')
  async reject(
    @Param('token') token: string,
    @Body('ipAddress') ipAddress?: string,
  ): Promise<OfferLetterResponse> {
    return this.offerLettersService.reject(token, ipAddress);
  }

  /**
   * Get offer letter tracking history (landlord only)
   * GET /offer-letters/:id/history
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get(':id/history')
  async getOfferLetterHistory(
    @Param('id') id: string,
    @CurrentUser() user: Account,
  ): Promise<
    Array<{
      id: string;
      eventType: string;
      eventDescription: string;
      createdAt: string;
    }>
  > {
    return this.offerLettersService.getOfferLetterHistory(id, user.id);
  }

  /**
   * Initiate payment for an offer letter
   * POST /offer-letters/:token/initiate-payment
   * Requirements: US-3, US-4, TR-4
   */
  @SkipAuth()
  @Post(':token/initiate-payment')
  async initiatePayment(
    @Param('token') token: string,
    @Body(ValidationPipe) dto: InitiatePaymentDto,
  ): Promise<any> {
    return this.paymentService.initiatePayment(token, dto);
  }

  /**
   * Track payment cancellation
   * POST /offer-letters/:token/payment-cancelled
   * Public endpoint - called when tenant cancels Paystack popup
   */
  @SkipAuth()
  @Post(':token/payment-cancelled')
  async trackPaymentCancelled(
    @Param('token') token: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.paymentService.trackPaymentCancelled(token);
  }

  /**
   * Get payment status for an offer letter
   * GET /offer-letters/:token/payment-status
   * Requirements: US-4, TR-4
   */
  @SkipAuth()
  @Get(':token/payment-status')
  async getPaymentStatus(@Param('token') token: string): Promise<any> {
    return this.paymentService.getPaymentStatus(token);
  }
}
