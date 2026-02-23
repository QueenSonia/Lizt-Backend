import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipAuth } from '../auth/auth.decorator';
import { Account } from '../users/entities/account.entity';
import { ReceiptsService } from './receipts.service';

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  /**
   * Get receipt by shareable token (public, no auth)
   * GET /receipts/public/:token
   * Requirements: 4.1, 4.2, 4.3
   */
  @SkipAuth()
  @Get('public/:token')
  async findByToken(@Param('token') token: string) {
    return this.receiptsService.findByToken(token);
  }

  /**
   * Track when tenant views a receipt (public endpoint)
   * POST /receipts/public/:token/track-view
   * Requirements: 6.1, 6.2, 6.3, 6.4, 12.6
   */
  @SkipAuth()
  @Post('public/:token/track-view')
  async trackReceiptView(
    @Param('token') token: string,
    @Body('ipAddress') ipAddress?: string,
  ) {
    return this.receiptsService.trackReceiptView(token, ipAddress);
  }

  /**
   * Get all receipts for an offer letter
   * GET /receipts/by-offer/:offerLetterId
   * Requirements: 7.1
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord', 'admin')
  @Get('by-offer/:offerLetterId')
  async findByOfferLetterId(
    @CurrentUser() user: Account,
    @Param('offerLetterId') offerLetterId: string,
  ) {
    return this.receiptsService.findByOfferLetterId(offerLetterId, user.id);
  }

  /**
   * Get all receipts for a property
   * GET /receipts/by-property/:propertyId
   * Requirements: 7.2
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord', 'admin')
  @Get('by-property/:propertyId')
  async findByPropertyId(
    @CurrentUser() user: Account,
    @Param('propertyId') propertyId: string,
  ) {
    return this.receiptsService.findByPropertyId(propertyId, user.id);
  }

  /**
   * Get single receipt by ID
   * GET /receipts/:id
   * Requirements: 7.3
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord', 'admin')
  @Get(':id')
  async findById(@CurrentUser() user: Account, @Param('id') id: string) {
    return this.receiptsService.findById(id, user.id);
  }

  /**
   * Download receipt PDF
   * GET /receipts/:id/download
   * Requirements: 7.4, 7.5
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord', 'admin')
  @Get(':id/download')
  async downloadPDF(
    @CurrentUser() user: Account,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.receiptsService.downloadPDF(id, user.id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id.substring(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  }
}
