import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  Put,
  Req,
  UseInterceptors,
  UploadedFiles,
  HttpStatus,
  HttpException,
  RawBodyRequest,
  Headers as HeadersDecorator,
} from '@nestjs/common';
import { ServiceRequestsService, TawkWebhookPayload } from './service-requests.service';
import {
  CreateServiceRequestDto,
  ServiceRequestFilter,
} from './dto/create-service-request.dto';
import {
  UpdateServiceRequestDto,
  UpdateServiceRequestResponseDto,
} from './dto/update-service-request.dto';
import {
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiQuery,
  ApiTags,
  ApiConsumes,
} from '@nestjs/swagger';
import { PaginationResponseDto } from './dto/paginate.dto';
import { FileUploadService } from 'src/utils/cloudinary';
import { FilesInterceptor } from '@nestjs/platform-express';
import * as crypto from 'crypto';

@ApiTags('Service-Requests')
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(
    private readonly serviceRequestsService: ServiceRequestsService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @ApiOperation({ summary: 'Create Service Request' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateServiceRequestDto })
  @ApiCreatedResponse({ type: CreateServiceRequestDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  // @UseInterceptors(FilesInterceptor('issue_images', 20))
  async createServiceRequest(
    @Body() body: CreateServiceRequestDto,
    // @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    try {
      // if (files?.length) {
      //   const uploadedUrls = await Promise.all(
      //     files.map((file) =>
      //       this.fileUploadService.uploadFile(file, 'service-requests'),
      //     ),
      //   );
      //   body.issue_images = uploadedUrls.map((upload) => upload.secure_url);
      // }
      return this.serviceRequestsService.createServiceRequest(body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Service Requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'property_id', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'start_date', required: false, type: String })
  @ApiQuery({ name: 'end_date', required: false, type: String })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of service requests',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllServiceRequests(@Query() query: ServiceRequestFilter, @Req() req: any) {
    try {
      const user_id = req?.user?.id

      return this.serviceRequestsService.getAllServiceRequests(user_id, query);
    } catch (error) {
      throw error;
    }
  }


  @ApiOperation({ summary: 'Get Pending and Urgent Requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of service requests',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('pending-urgent')
  getPendingAndUrgentRequests(
    @Query() query: ServiceRequestFilter,
    @Req() req: any,
  ) {
    try {
      return this.serviceRequestsService.getPendingAndUrgentRequests(
        query,
        req?.user.id,
      );
    } catch (error) {
      throw error;
    }
  }

    @ApiOperation({ summary: 'Get One Service Request' })
  @ApiOkResponse({
    type: CreateServiceRequestDto,
    description: 'Service request successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Service request not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('/tenant')
  getServiceRequestByTenant(
     @Req() req: any
    ) {
    try {
      const status = req?.query?.status || '';
      return this.serviceRequestsService.getServiceRequestByTenant(req?.user.id, status);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get One Service Request' })
  @ApiOkResponse({
    type: CreateServiceRequestDto,
    description: 'Service request successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Service request not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  getServiceRequestById(
    @Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.serviceRequestsService.getServiceRequestById(id);
    } catch (error) {
      throw error;
    }
  }


  @ApiOperation({ summary: 'Update Service Request' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdateServiceRequestResponseDto })
  @ApiOkResponse({ description: 'Service request successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  @UseInterceptors(FilesInterceptor('issue_images', 20))
  async updateServiceRequestById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateServiceRequestResponseDto,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    try {
      if (files?.length) {
        const uploadedUrls = await Promise.all(
          files.map((file) =>
            this.fileUploadService.uploadFile(file, 'service-requests'),
          ),
        );
        body.issue_images = uploadedUrls.map((upload) => upload.secure_url);
      }
      return this.serviceRequestsService.updateServiceRequestById(id, body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Delete Service Request' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  deleteServiceRequestById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.serviceRequestsService.deleteServiceRequestById(id);
    } catch (error) {
      throw error;
    }
  }


  @Post('tawk')
  async handleTawkWebhook(
    @Body() payload: TawkWebhookPayload,
     @HeadersDecorator() headers: Record<string, string>,
      @Req() req: RawBodyRequest<Request>
  ) {
    try {

         // Validate webhook signature if secret is configured
      this.validateTawkSignature(req, headers);

      // Log the incoming webhook for debugging
      console.log(`Received Tawk webhook: ${payload.event} for chat ${payload.chatId}`);
      console.log('Webhook payload:', JSON.stringify(payload, null, 2));

      // Validate required fields
      if (!payload.event || !payload.chatId || !payload.property?.id) {
        throw new HttpException(
          'Invalid webhook payload: missing required fields',
          HttpStatus.BAD_REQUEST
        );
      }

      // Process supported events
      if (this.isSupportedEvent(payload.event)) {
        const serviceRequest = await this.serviceRequestsService.tawkServiceRequest(payload);
        
        console.log(`Service request created: ${serviceRequest.id} for event: ${payload.event}`);
        
        return { 
          success: true, 
          serviceRequestId: serviceRequest.id,
          message: `Service request created successfully for ${payload.event}`,
          timestamp: new Date().toISOString()
        };
      }
      
      // Log unsupported events but return success to avoid retries
      console.log(`Unsupported event type: ${payload.event}`);
      return { 
        success: true, 
        message: `Event ${payload.event} received but not processed`,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.log('Tawk webhook processing error:', error.stack);
      
      // Return appropriate HTTP status codes
      if (error instanceof HttpException) {
        throw error;
      }
      
      // For database or service errors, return 500
      throw new HttpException(
        'Internal server error processing webhook',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

private validateTawkSignature(req: RawBodyRequest<Request>, headers: Record<string, string>): void {
    const webhookSecret = process.env.TAWK_WEBHOOK_SECRET;
    
    // Skip validation if no secret is configured
    if (!webhookSecret) {
      console.log('No TAWK_WEBHOOK_SECRET configured, skipping signature validation');
      return;
    }

    const signature = headers['x-tawk-signature'] || headers['x-hub-signature-256'];
    
    if (!signature) {
      throw new HttpException(
        'Missing webhook signature header',
        HttpStatus.UNAUTHORIZED
      );
    }

    // Get raw body for signature validation
    const rawBody = req.rawBody || req.body;
    let bodyString: string;

    if (Buffer.isBuffer(rawBody)) {
      bodyString = rawBody.toString('utf8');
    } else if (typeof rawBody === 'string') {
      bodyString = rawBody;
    } else {
      bodyString = JSON.stringify(rawBody);
    }

    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(bodyString, 'utf8')
      .digest('hex');

    // Format expected signature to match header format
    const formattedExpectedSignature = `sha256=${expectedSignature}`;

    // Compare signatures securely
    const isValidSignature = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(formattedExpectedSignature)
    );

    if (!isValidSignature) {
      console.log('Invalid Tawk webhook signature');
      throw new HttpException(
        'Invalid webhook signature',
        HttpStatus.UNAUTHORIZED
      );
    }

    console.log('Tawk webhook signature validated successfully');
  }


  private isSupportedEvent(event: string): boolean {
    return ['chat:start', 'chat:end', 'ticket:create'].includes(event);
  }

  // Health check endpoint for Tawk.to to verify webhook is working
  @Post('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'tawk-webhook',
      timestamp: new Date().toISOString()
    };
  }
}
