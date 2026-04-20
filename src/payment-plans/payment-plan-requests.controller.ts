import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { PaymentPlanRequestsService } from './payment-plan-requests.service';
import { DeclinePaymentPlanRequestDto } from './dto/decline-payment-plan-request.dto';

@ApiTags('Payment-Plan-Requests')
@Controller('payment-plan-requests')
export class PaymentPlanRequestsController {
  constructor(
    private readonly requestsService: PaymentPlanRequestsService,
  ) {}

  @ApiOperation({ summary: 'List payment plan requests' })
  @ApiQuery({ name: 'propertyTenantId', required: false, type: String })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiOkResponse({ description: 'Payment plan requests' })
  @ApiSecurity('access_token')
  @Get()
  list(
    @Query('propertyTenantId') propertyTenantId?: string,
    @Query('propertyId') propertyId?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.requestsService.list(propertyTenantId, propertyId, tenantId);
  }

  @ApiOperation({ summary: 'Get a payment plan request' })
  @ApiOkResponse({ description: 'Payment plan request' })
  @ApiSecurity('access_token')
  @Get(':id')
  getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.requestsService.getOne(id);
  }

  @ApiOperation({ summary: 'Decline a pending payment plan request' })
  @ApiBody({ type: DeclinePaymentPlanRequestDto })
  @ApiOkResponse({ description: 'Request declined' })
  @ApiSecurity('access_token')
  @Post(':id/decline')
  decline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DeclinePaymentPlanRequestDto,
    @Req() req: any,
  ) {
    return this.requestsService.decline(id, dto, req?.user?.id);
  }
}
