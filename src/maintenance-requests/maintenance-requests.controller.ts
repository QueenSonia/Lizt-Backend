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
import { ApproveMaintenanceRequestDto } from './dto/approve-maintenance-request.dto';
import { TenantDenyMaintenanceRequestDto } from './dto/tenant-deny-maintenance-request.dto';
import { RejectMaintenanceRequestDto } from './dto/reject-maintenance-request.dto';
import { SetPriorityDto } from './dto/set-priority.dto';
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
    summary: 'Get resolution attempt history for a maintenance request',
    description:
      'One row per FM resolve, newest first. Includes snapshot fields and outcome (pending | confirmed | denied | reopened). Landlord + FM on the request only.',
  })
  @ApiOkResponse({ description: 'Array of resolution attempts (newest first)' })
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Get(':id/resolution-attempts')
  getResolutionAttempts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    return this.maintenanceRequestsService.getResolutionAttempts(
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

  @ApiOperation({
    summary: 'Toggle the priority flag on a maintenance request',
    description:
      'Landlord-only. Sets or clears the `is_priority` flag on a request the landlord owns.',
  })
  @ApiBody({ type: SetPriorityDto })
  @ApiOkResponse({ description: 'Priority updated' })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Patch(':id/priority')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async setMaintenanceRequestPriority(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetPriorityDto,
    @CurrentUser() requester: Account,
  ) {
    return this.maintenanceRequestsService.setPriority(
      id,
      body.is_priority,
      requester.id,
    );
  }

  @ApiOperation({
    summary: 'Tenant confirms an FM-filed maintenance request',
    description:
      "Caller must be the tenant on the request (account.id === sr.tenant_id). Status must be PENDING_TENANT_CONFIRMATION; otherwise 409. Transitions to NOT_APPROVED so the landlord can take the existing approve/reject + FM-picker flow.",
  })
  @ApiOkResponse({ description: 'Request confirmed; moved to NOT_APPROVED' })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Post(':id/tenant-confirm')
  async tenantConfirmMaintenanceRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() requester: Account,
  ) {
    return this.maintenanceRequestsService.confirmTenantMaintenanceRequest(
      id,
      requester.id,
      'dashboard',
    );
  }

  @ApiOperation({
    summary: 'Tenant denies an FM-filed maintenance request',
    description:
      'Caller must be the tenant on the request. Optional `reason` captured in rejection_reason. Terminal — lands in DENIED_BY_TENANT.',
  })
  @ApiBody({ type: TenantDenyMaintenanceRequestDto, required: false })
  @ApiOkResponse({ description: 'Request denied; moved to DENIED_BY_TENANT' })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Post(':id/tenant-deny')
  async tenantDenyMaintenanceRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TenantDenyMaintenanceRequestDto,
    @CurrentUser() requester: Account,
  ) {
    return this.maintenanceRequestsService.denyTenantMaintenanceRequest(
      id,
      requester.id,
      body?.reason ?? null,
      'dashboard',
    );
  }

  @ApiOperation({
    summary:
      "Landlord force-confirms a maintenance request stuck on tenant confirmation",
    description:
      "Landlord-only. Use when the tenant has no phone / isn't responding. Status must be PENDING_TENANT_CONFIRMATION; transitions to NOT_APPROVED and records the landlord-as-actor in status_history. Does not double-ping the landlord on WhatsApp.",
  })
  @ApiOkResponse({ description: 'Force-confirmed; moved to NOT_APPROVED' })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Post(':id/landlord-force-confirm')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async landlordForceConfirmMaintenanceRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() requester: Account,
  ) {
    return this.maintenanceRequestsService.landlordForceConfirmMaintenanceRequest(
      id,
      requester.id,
    );
  }

  @ApiOperation({
    summary: 'Reject a maintenance request from the dashboard',
    description:
      'Landlord-only. Mirrors the WhatsApp Reject flow. Status must be NOT_APPROVED (409 otherwise). Optional `reason` captured in rejection_reason. Terminal — lands in REJECTED.',
  })
  @ApiBody({ type: RejectMaintenanceRequestDto, required: false })
  @ApiOkResponse({ description: 'Request rejected; moved to REJECTED' })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Post(':id/reject')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async rejectMaintenanceRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RejectMaintenanceRequestDto,
    @CurrentUser() requester: Account,
  ) {
    return this.maintenanceRequestsService.rejectMaintenanceRequest(
      id,
      requester.id,
      body?.reason ?? null,
      'dashboard',
    );
  }

  @ApiOperation({
    summary: 'Approve a maintenance request and assign a facility manager',
    description:
      'Landlord-only. Combined transaction: flips status NOT_APPROVED → APPROVED and sets `assigned_to` in one call. Source status must be NOT_APPROVED (409 otherwise). Fans out fm_assignment_notification to the team; suppresses the standalone approval ping to the assignee.',
  })
  @ApiBody({ type: ApproveMaintenanceRequestDto })
  @ApiOkResponse({ description: 'Request approved and assigned' })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  @ApiSecurity('access_token')
  @Post(':id/approve')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async approveMaintenanceRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ApproveMaintenanceRequestDto,
    @CurrentUser() requester: Account,
  ) {
    return this.maintenanceRequestsService.approveAndAssignMaintenanceRequest(
      id,
      body.assigned_to,
      requester.id,
      'dashboard',
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
