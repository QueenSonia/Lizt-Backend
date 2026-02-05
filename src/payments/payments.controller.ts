import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Account } from '../users/entities/account.entity';
import { PaymentService } from './payment.service';

/**
 * PaymentsController
 * Handles payment-related API endpoints for landlords
 * Requirements: TR-4, US-8
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Get all payments for landlord's properties
   * GET /payments/landlord
   * Requirements: US-8, TR-4
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('landlord')
  @Get('landlord')
  async getLandlordPayments(
    @CurrentUser() user: Account,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ): Promise<any> {
    return this.paymentService.getLandlordPayments(user.id, {
      status,
      search,
      page,
      limit,
    });
  }

  /**
   * Get payment details for a specific offer letter
   * GET /payments/:offerId
   * Requirements: US-8, TR-4
   */
  @UseGuards(JwtAuthGuard)
  @Get(':offerId')
  async getPaymentByOfferId(@Param('offerId') offerId: string): Promise<any> {
    return this.paymentService.getPaymentStatus(offerId);
  }
}
