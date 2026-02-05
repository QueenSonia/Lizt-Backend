import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, UpdateInvoiceDto, InvoiceQueryDto } from './dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RoleGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  /**
   * Get all invoices for landlord
   */
  @Get()
  @Roles('landlord', 'admin')
  async findAll(
    @CurrentUser() user: { id: string },
    @Query() query: InvoiceQueryDto,
  ) {
    return this.invoicesService.findAll(user.id, query);
  }

  /**
   * Get actionable invoices (pending or partially paid)
   */
  @Get('actionable')
  @Roles('landlord', 'admin')
  async findActionable(
    @CurrentUser() user: { id: string },
    @Query() query: InvoiceQueryDto,
  ) {
    return this.invoicesService.findActionable(user.id, query);
  }

  /**
   * Get single invoice by ID
   */
  @Get(':id')
  @Roles('landlord', 'admin')
  async findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.invoicesService.findOne(id, user.id);
  }

  /**
   * Create new invoice
   */
  @Post()
  @Roles('landlord', 'admin')
  async create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(user.id, dto);
  }

  /**
   * Generate invoice from offer letter
   */
  @Post('from-offer/:offerLetterId')
  @Roles('landlord', 'admin')
  async generateFromOfferLetter(
    @CurrentUser() user: { id: string },
    @Param('offerLetterId') offerLetterId: string,
  ) {
    return this.invoicesService.generateFromOfferLetter(offerLetterId, user.id);
  }

  /**
   * Update invoice
   */
  @Put(':id')
  @Roles('landlord', 'admin')
  async update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, user.id, dto);
  }

  /**
   * Cancel invoice
   */
  @Delete(':id')
  @Roles('landlord', 'admin')
  async cancel(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.invoicesService.cancel(id, user.id);
  }

  /**
   * Send payment reminder
   */
  @Post(':id/send-reminder')
  @Roles('landlord', 'admin')
  async sendReminder(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.invoicesService.sendReminder(id, user.id);
  }
}
