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
import { UpdateServiceRequestResponseDto } from './dto/update-service-request.dto';
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
import { ServiceRequestPaginationResponseDto } from './dto/paginate.dto';
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
  async createServiceRequest(
    @Body() body: CreateServiceRequestDto,
    @Req() req: any,
  ) {
    return this.serviceRequestsService.createServiceRequest(body, {
      id: req?.user?.id,
      role: req?.user?.role,
    });
  }

  @ApiOperation({ summary: 'Get All Service Requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'property_id', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['unit', 'common_area'],
  })
  @ApiQuery({
    name: 'creator_type',
    required: false,
    enum: ['tenant', 'facility_manager'],
  })
  @ApiQuery({ name: 'is_urgent', required: false, type: Boolean })
  @ApiQuery({ name: 'start_date', required: false, type: String })
  @ApiQuery({ name: 'end_date', required: false, type: String })
  @ApiOkResponse({
    type: ServiceRequestPaginationResponseDto,
    description: 'Paginated list of service requests',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllServiceRequests(@Query() query: ServiceRequestFilter, @Req() req: any) {
    const user_id = req?.user?.id;
    const role = req?.user?.role;
    return this.serviceRequestsService.getAllServiceRequests(
      user_id,
      query,
      role,
    );
  }

  @ApiOperation({ summary: 'Get Pending and Urgent Requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiOkResponse({
    type: ServiceRequestPaginationResponseDto,
    description: 'Paginated list of service requests',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('pending-urgent')
  getPendingAndUrgentRequests(
    @Query() query: ServiceRequestFilter,
    @Req() req: any,
  ) {
    return this.serviceRequestsService.getPendingAndUrgentRequests(
      query,
      req?.user.id,
    );
  }

  @ApiOperation({
    summary: 'Common-area request counts grouped by property',
    description:
      "Used by the landlord's Common Areas tab. Returns one row per property the landlord owns that has at least one common-area request, with total and open counts.",
  })
  @ApiOkResponse({
    description: 'Per-property common-area request counts',
  })
  @ApiSecurity('access_token')
  @Get('common-areas-by-property')
  getCommonAreasByProperty(@Req() req: any) {
    return this.serviceRequestsService.getCommonAreaCountsByProperty(
      req?.user?.id,
    );
  }

  @ApiOperation({ summary: 'Get Service Requests by Tenant' })
  @ApiOkResponse({
    type: CreateServiceRequestDto,
    description: 'Service request successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Service request not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('/tenant')
  getServiceRequestByTenant(@Req() req: any) {
    const status = req?.query?.status || '';
    return this.serviceRequestsService.getServiceRequestByTenant(
      req?.user.id,
      status,
    );
  }

  @ApiOperation({
    summary: 'FM activity feed across all managed properties',
    description:
      "Cursor-paginated stream of every status_history row (incl. creation events) on service requests filed against properties the requesting facility manager manages. Used to drive the FM dashboard's live activity feed. Pass back the previous response's `pagination.nextCursor` to fetch older events. Optional `landlordId` query param scopes the feed to a single landlord (used by the FM's landlord pill bar).",
  })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'cursor_changed_at', required: false, type: String })
  @ApiQuery({ name: 'cursor_id', required: false, type: String })
  @ApiQuery({ name: 'landlord_id', required: false, type: String })
  @ApiOkResponse({ description: 'Activity feed page + nextCursor' })
  @ApiSecurity('access_token')
  @Get('activity-feed')
  getFacilityManagerActivityFeed(
    @Query('size') size: string | undefined,
    @Query('cursor_changed_at') cursorChangedAt: string | undefined,
    @Query('cursor_id') cursorId: string | undefined,
    @Query('landlord_id') landlordId: string | undefined,
    @Req() req: any,
  ) {
    return this.serviceRequestsService.getActivityFeedForFacilityManager(
      req?.user?.id,
      {
        size: size ? Number(size) : undefined,
        cursor:
          cursorChangedAt && cursorId
            ? { changed_at: cursorChangedAt, id: cursorId }
            : undefined,
        landlordId: landlordId || undefined,
      },
    );
  }

  @ApiOperation({
    summary: 'Status transition history for a service request',
    description:
      'Returns the full audit trail (previous_status → new_status, actor, role, change reason, timestamp). Used to render the Activity timeline in the request detail modal. Includes the reopen message tenants leave when reopening a resolved request.',
  })
  @ApiOkResponse({ description: 'Ordered list of status transitions' })
  @ApiNotFoundResponse({ description: 'Service request not found' })
  @ApiSecurity('access_token')
  @Get(':id/history')
  getServiceRequestHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    return this.serviceRequestsService.getStatusHistory(id, req?.user?.id);
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    return this.serviceRequestsService.getServiceRequestById(
      id,
      req?.user?.id,
    );
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
    @Req() req: any,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    if (files?.length) {
      const uploadedUrls = await Promise.all(
        files.map((file) =>
          this.fileUploadService.uploadFile(file, 'service-requests'),
        ),
      );
      body.issue_images = uploadedUrls.map((upload) => upload.secure_url);
    }
    return this.serviceRequestsService.updateServiceRequestById(
      id,
      body,
      req?.user?.id,
    );
  }

  @ApiOperation({ summary: 'Delete Service Request' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  deleteServiceRequestById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    return this.serviceRequestsService.deleteServiceRequestById(
      id,
      req?.user?.id,
    );
  }

  @Post('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'tawk-webhook',
      timestamp: new Date().toISOString(),
    };
  }
}
