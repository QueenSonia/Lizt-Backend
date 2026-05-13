import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { PropertyHistoryService } from './property-history.service';
import { PaymentHistoryPdfService } from './payment-history-pdf.service';
import { Public } from '../auth/public.decorator';
import {
  CreatePropertyHistoryDto,
  PropertyHistoryFilter,
} from './dto/create-property-history.dto';
import { UpdatePropertyHistoryDto } from './dto/update-property-history.dto';
import { PropertyHistoryPaginationResponseDto } from './dto/paginate.dto';

@ApiTags('Property-History')
@Controller('property-history')
export class PropertyHistoryController {
  constructor(
    private readonly propertyHistoryService: PropertyHistoryService,
    private readonly paymentHistoryPdfService: PaymentHistoryPdfService,
  ) {}

  @ApiOperation({
    summary: 'Get payment-history receipt by token (public)',
  })
  @ApiOkResponse({ description: 'Receipt view' })
  @Public()
  @Get('receipts/:token')
  async getPaymentReceiptView(@Param('token') token: string) {
    const data = await this.paymentHistoryPdfService.getPaymentReceiptView(
      token,
    );
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Download payment-history receipt PDF by token (public)',
  })
  @ApiOkResponse({
    description: 'PDF stream',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Public()
  @Get('receipts/:token/download')
  async downloadPaymentReceipt(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const view =
        await this.paymentHistoryPdfService.getPaymentReceiptView(token);
      const pdf =
        await this.paymentHistoryPdfService.generatePaymentReceiptPDF(token);
      const filename =
        this.paymentHistoryPdfService.generateReceiptFilename(
          view.property?.name,
          view.receiptDate ? new Date(view.receiptDate) : new Date(),
        );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.send(pdf);
    } catch (error: any) {
      throw new HttpException(
        error?.message || 'Failed to download receipt',
        error?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({
    summary: 'Send payment-history receipt to tenant via WhatsApp',
  })
  @ApiOkResponse({ description: 'Receipt sent' })
  @ApiBadRequestResponse({ description: 'Tenant has no phone on record' })
  @ApiSecurity('access_token')
  @Post('receipts/:token/send-whatsapp')
  async sendReceiptViaWhatsApp(@Param('token') token: string) {
    await this.paymentHistoryPdfService.sendReceiptViaWhatsApp(token);
    return { success: true };
  }

  @ApiOperation({ summary: 'Create Property History' })
  @ApiBody({ type: CreatePropertyHistoryDto })
  @ApiCreatedResponse({ description: 'Property history created successfully' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  createPropertyHistory(@Body() body: CreatePropertyHistoryDto) {
    try {
      return this.propertyHistoryService.createPropertyHistory(body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Property Histories' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'property_id', required: false, type: String })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'move_in_date', required: false, type: String })
  @ApiQuery({ name: 'move_out_date', required: false, type: String })
  @ApiOkResponse({
    type: PropertyHistoryPaginationResponseDto,
    description: 'Paginated list of property histories',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllPropertyHistories(@Query() query: PropertyHistoryFilter) {
    try {
      return this.propertyHistoryService.getAllPropertyHistories(query);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get One Property History' })
  @ApiOkResponse({
    description: 'Property history successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Property history not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  getPropertyHistoryById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.propertyHistoryService.getPropertyHistoryById(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Update Property History' })
  @ApiBody({ type: UpdatePropertyHistoryDto })
  @ApiOkResponse({ description: 'Property history successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  updatePropertyHistoryById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePropertyHistoryDto,
  ) {
    try {
      return this.propertyHistoryService.updatePropertyHistoryById(id, body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Delete Property History' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  deletePropertyHistoryById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.propertyHistoryService.deletePropertyHistoryById(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Property Histories by Tenant ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiOkResponse({
    type: PropertyHistoryPaginationResponseDto,
    description: 'Property histories for tenant successfully fetched',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('tenant-property/:property_id')
  async getMaintenanceRequestsByTenantAndProperty(
    @Param('property_id', new ParseUUIDPipe()) property_id: string,
    @Query() query: PropertyHistoryFilter,
    @Req() req: any,
  ) {
    try {
      const tenant_id = req?.user?.id;
      return this.propertyHistoryService.getPropertyHistoryByTenantId(
        tenant_id,
        property_id,
        query,
      );
    } catch (error) {
      throw error;
    }
  }
}
