import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  ValidationPipe,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RenewalLettersService } from './renewal-letters.service';
import { VerifyAcceptRenewalOtpDto } from './dto/verify-renewal-otp.dto';
import { VerifyRejectRenewalOtpDto } from './dto/verify-reject-renewal-otp.dto';
import {
  RenewalLetterPublicDto,
  InitiateOtpResponseDto,
} from './dto/renewal-letter-public.dto';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { RenewalLetterPdfService } from '../pdf/renewal-letter-pdf.service';

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
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    private readonly renewalLetterPdfService: RenewalLetterPdfService,
  ) {}

  @Public()
  @Get(':token')
  async getLetter(
    @Param('token') token: string,
  ): Promise<RenewalLetterPublicDto> {
    return this.renewalLettersService.getPublicLetter(token);
  }

  /**
   * Public PDF download — token is the auth. Used by both the tenant
   * page (Download button) and the landlord screen (Download PDF
   * button); the latter passes the same opaque token from the active
   * pending renewal invoice. Mirrors offer-letters' /:token/pdf:
   * redirects to the cached Cloudinary URL when fresh, otherwise
   * regenerates and streams the new buffer (and persists the URL).
   */
  @Public()
  @Get(':token/pdf')
  async downloadPdf(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      select: [
        'id',
        'token',
        'pdf_url',
        'pdf_generated_at',
        'letter_sent_at',
        'accepted_at',
        'declined_at',
        'property_id',
      ],
    });
    if (!invoice) {
      throw new NotFoundException('Renewal letter not found');
    }

    // Try the cache first — getOrGenerateUrl returns a URL either way.
    // On cache hit it's a redirect; on miss it regenerates, persists,
    // then redirects. Cache invalidates if pdf_generated_at is older
    // than the most recent letter_sent_at / accepted_at / declined_at.
    try {
      const url = await this.renewalLetterPdfService.getOrGenerateUrl(
        invoice.id,
      );
      res.redirect(url);
      return;
    } catch {
      // Fallback: stream a fresh buffer if Cloudinary is unhappy. The
      // tenant still gets their document; the cache stays empty until
      // the next successful upload.
      const pdf = await this.renewalLetterPdfService.generatePdfBuffer(
        invoice.id,
      );
      const filename = this.renewalLetterPdfService.buildFilename(
        `letter-${token.substring(0, 8)}`,
      );
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdf.length,
      });
      res.send(pdf);
    }
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
