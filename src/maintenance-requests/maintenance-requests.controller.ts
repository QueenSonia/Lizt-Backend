import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  Patch,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { MaintenanceRequestsService } from './maintenance-requests.service';
import {
  CreateMaintenanceRequestDto,
  MaintenanceRequestFilter,
} from './dto/create-maintenance-request.dto';
import { UpdateMaintenanceRequestResponseDto } from './dto/update-maintenance-request.dto';
import { AssignMaintenanceRequestDto } from './dto/assign-maintenance-request.dto';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { RolesEnum } from 'src/base.entity';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { Account } from 'src/users/entities/account.entity';
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
import { MaintenanceRequestPaginationResponseDto } from './dto/paginate.dto';
import { FileUploadService } from 'src/utils/cloudinary';
import { FilesInterceptor } from '@nestjs/platform-express';

@ApiTags('Maintenance-Requests')
@Controller('maintenance-requests')
export class MaintenanceRequestsController {
  constructor(
    private readonly maintenanceRequestsService: MaintenanceRequestsService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @ApiOperation({ summary: 'Create Maintenance Request' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateMaintenanceRequestDto })
  @ApiCreatedResponse({ type: CreateMaintenanceRequestDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  async createMaintenanceRequest(
    @Body() body: CreateMaintenanceRequestDto,
    @Req() req: any,
  ) {
    return this.maintenanceRequestsService.createMaintenanceRequest(body, {
      id: req?.user?.id,
      role: req?.user?.role,
    });
  }

  @ApiOperation({ summary: 'Get All Maintenance Requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'property_id', required: false, type: String })
  @ApiQuery({ name: 'common_area_id', required: false, type: String })
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
    type: MaintenanceRequestPaginationResponseDto,
    description: 'Paginated list of maintenance requests',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllMaintenanceRequests(@Query() query: MaintenanceRequestFilter, @Req() req: any) {
    const user_id = req?.user?.id;
    const role = req?.user?.role;
    return this.maintenanceRequestsService.getAllMaintenanceRequests(
      user_id,
      query,
      role,
    );
  }

  @ApiOperation({ summary: 'Get Pending and Urgent Requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiOkResponse({
    type: MaintenanceRequestPaginationResponseDto,
    description: 'Paginated list of maintenance requests',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('pending-urgent')
  getPendingAndUrgentRequests(
    @Query() query: MaintenanceRequestFilter,
    @Req() req: any,
  ) {
    return this.maintenanceRequestsService.getPendingAndUrgentRequests(
      query,
      req?.user.id,
    );
  }

  @ApiOperation({ summary: 'Get Maintenance Requests by Tenant' })
  @ApiOkResponse({
    type: CreateMaintenanceRequestDto,
    description: 'Maintenance request successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('/tenant')
  getMaintenanceRequestByTenant(@Req() req: any) {
    const status = req?.query?.status || '';
    return this.maintenanceRequestsService.getMaintenanceRequestByTenant(
      req?.user.id,
      status,
    );
  }

  @ApiOperation({
    summary: 'FM activity feed across all managed properties',
    description:
      "Cursor-paginated stream of every status_history row (incl. creation events) on maintenance requests filed against properties the requesting facility manager manages. Used to drive the FM dashboard's live activity feed. Pass back the previous response's `pagination.nextCursor` to fetch older events. Optional `landlordId` query param scopes the feed to a single landlord (used by the FM's landlord pill bar).",
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
    return this.maintenanceRequestsService.getActivityFeedForFacilityManager(
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
    summary: 'Status transition history for a maintenance request',
    description:
      'Returns the full audit trail (previous_status → new_status, actor, role, change reason, timestamp). Used to render the Activity timeline in the request detail modal. Includes the reopen message tenants leave when reopening a resolved request.',
  })
  @ApiOkResponse({ description: 'Ordered list of status transitions' })
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Get(':id/history')
  getMaintenanceRequestHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    return this.maintenanceRequestsService.getStatusHistory(id, req?.user?.id);
  }

  @ApiOperation({ summary: 'Get One Maintenance Request' })
  @ApiOkResponse({
    type: CreateMaintenanceRequestDto,
    description: 'Maintenance request successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  getMaintenanceRequestById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    return this.maintenanceRequestsService.getMaintenanceRequestById(
      id,
      req?.user?.id,
    );
  }

  @ApiOperation({
    summary: 'Assign or unassign a facility manager to a maintenance request',
    description:
      'Landlord-only. Sets the facility manager handling this request. Pass `assigned_to: null` to clear the assignment. The assignee must be a FACILITY_MANAGER team_member on the landlord\'s team.',
  })
  @ApiBody({ type: AssignMaintenanceRequestDto })
  @ApiOkResponse({ description: 'Assignment updated' })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Patch(':id/assignee')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async setMaintenanceRequestAssignee(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AssignMaintenanceRequestDto,
    @CurrentUser() requester: Account,
  ) {
    return this.maintenanceRequestsService.setAssignee(
      id,
      body?.assigned_to ?? null,
      requester.id,
    );
  }

  @ApiOperation({ summary: 'Update Maintenance Request' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdateMaintenanceRequestResponseDto })
  @ApiOkResponse({ description: 'Maintenance request successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  @UseInterceptors(FilesInterceptor('issue_images', 20))
  async updateMaintenanceRequestById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateMaintenanceRequestResponseDto,
    @Req() req: any,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    if (files?.length) {
      const uploadedUrls = await Promise.all(
        files.map((file) =>
          this.fileUploadService.uploadFile(file, 'maintenance-requests'),
        ),
      );
      body.issue_images = uploadedUrls.map((upload) => upload.secure_url);
    }
    return this.maintenanceRequestsService.updateMaintenanceRequestById(
      id,
      body,
      req?.user?.id,
    );
  }

  @ApiOperation({ summary: 'Delete Maintenance Request' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  deleteMaintenanceRequestById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    return this.maintenanceRequestsService.deleteMaintenanceRequestById(
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
