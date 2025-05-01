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
} from '@nestjs/common';
import { ServiceRequestsService } from './service-requests.service';
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
  @UseInterceptors(FilesInterceptor('issue_images', 20))
  async createServiceRequest(
    @Body() body: CreateServiceRequestDto,
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
  getAllServiceRequests(@Query() query: ServiceRequestFilter) {
    try {
      return this.serviceRequestsService.getAllServiceRequests(query);
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
  @Get(':id')
  getServiceRequestById(@Param('id', new ParseUUIDPipe()) id: string) {
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
}
