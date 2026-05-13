import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateMaintenanceRequestDto,
  MaintenanceRequestCreatorTypeEnum,
  MaintenanceRequestFilter,
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from './dto/create-maintenance-request.dto';
import { UpdateMaintenanceRequestResponseDto } from './dto/update-maintenance-request.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { MaintenanceRequest } from './entities/maintenance-request.entity';
import { MaintenanceRequestStatusHistory } from './entities/maintenance-request-status-history.entity';
import { In, Repository } from 'typeorm';
import { buildMaintenanceRequestFilter } from 'src/filters/query-filter';
import { UtilService } from 'src/utils/utility-service';
import { config } from 'src/config';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { RolesEnum } from 'src/base.entity';
import { CommonArea } from 'src/common-areas/entities/common-area.entity';

export interface TawkWebhookPayload {
  event: 'chat:start' | 'chat:end';
  chatId: string;
  time: string;
  message?: {
    text: string;
    type: string;
    sender: {
      type: 'visitor' | 'agent';
    };
  };
  visitor: {
    name: string;
    email: string;
    city: string;
    country: string;
  };
  property: {
    id: string;
    name: string;
  };
}

interface RequestActor {
  id: string;
  role: string;
}

@Injectable()
export class MaintenanceRequestsService {
  private readonly logger = new Logger(MaintenanceRequestsService.name);

  constructor(
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepository: Repository<MaintenanceRequest>,
    @InjectRepository(MaintenanceRequestStatusHistory)
    private readonly statusHistoryRepository: Repository<MaintenanceRequestStatusHistory>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(CommonArea)
    private readonly commonAreaRepository: Repository<CommonArea>,
    private readonly eventEmitter: EventEmitter2,
    private readonly utilService: UtilService,
  ) {}

  async createMaintenanceRequest(
    data: CreateMaintenanceRequestDto,
    actor?: RequestActor,
  ): Promise<any> {
    this.assertScopeIdsCoherent(data);
    if (actor?.role === RolesEnum.FACILITY_MANAGER) {
      return this.createMaintenanceRequestAsFacilityManager(data, actor);
    }
    return this.createMaintenanceRequestAsTenant(data, actor);
  }

  /**
   * scope='unit' requires property_id (no common_area_id).
   * scope='common_area' requires common_area_id (no property_id).
   * Default scope is 'unit' when not provided.
   */
  private assertScopeIdsCoherent(data: CreateMaintenanceRequestDto): void {
    const scope = data.scope ?? MaintenanceRequestScopeEnum.UNIT;
    if (scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      if (!data.common_area_id) {
        throw new HttpException(
          'common_area_id is required when scope is common_area',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (data.property_id) {
        throw new HttpException(
          'property_id must not be set when scope is common_area',
          HttpStatus.BAD_REQUEST,
        );
      }
      return;
    }
    // scope === UNIT
    if (!data.property_id) {
      throw new HttpException(
        'property_id is required when scope is unit',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (data.common_area_id) {
      throw new HttpException(
        'common_area_id must not be set when scope is unit',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async createMaintenanceRequestAsTenant(
    data: CreateMaintenanceRequestDto,
    actor?: RequestActor,
  ): Promise<any> {
    const tenantUserId = actor?.id;
    if (!tenantUserId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Resolve the tenant's PropertyTenant row for this property — confirms
    // active tenancy AND gives us the Account.id (not the User.id) for the
    // tenant_id column.
    const tenantExistInProperty = await this.propertyTenantRepository.findOne({
      where: {
        tenant: { user: { id: tenantUserId } },
        property_id: data.property_id,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!tenantExistInProperty?.id) {
      throw new HttpException(
        'You are not currently renting this property',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Fan out to every FM on the landlord's team — assignment now happens
    // per maintenance request, so all team FMs are kept in the loop until
    // the landlord picks one.
    const teamFms = await this.findTeamFmsForLandlord(
      tenantExistInProperty.property.owner_id,
    );
    const selected_managers = teamFms
      .filter((fm) => fm.account?.user?.phone_number)
      .map((fm) => ({
        phone_number: this.utilService.normalizePhoneNumber(
          fm.account.user.phone_number,
        ),
        name: this.utilService.toSentenceCase(
          fm.account.user.first_name ?? 'Facility Manager',
        ),
      }));

    const requestId = this.utilService.generateMaintenanceRequestId();
    const tenantName =
      `${tenantExistInProperty.tenant.user.first_name} ${tenantExistInProperty.tenant.user.last_name}`.trim();

    const request = this.maintenanceRequestRepository.create({
      request_id: requestId,
      tenant_id: tenantExistInProperty.tenant.id,
      property_id: tenantExistInProperty.property?.id,
      tenant_name: tenantName,
      property_name: tenantExistInProperty.property?.name,
      issue_category: 'service',
      date_reported: new Date(),
      description: data.text,
      status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      scope: data.scope ?? MaintenanceRequestScopeEnum.UNIT,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.TENANT,
      creator_user_id: tenantExistInProperty.tenant.user.id,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      tenantExistInProperty.tenant.user.id,
      'tenant',
      'Maintenance request created',
    );

    try {
      this.eventEmitter.emit('maintenance.created', {
        user_id: tenantExistInProperty.tenant.id,
        property_id: tenantExistInProperty.property?.id,
        landlord_id: tenantExistInProperty.property?.owner_id,
        tenant_name: tenantName,
        property_name: tenantExistInProperty.property.name,
        maintenance_request_id: savedRequest.id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: MaintenanceRequestCreatorTypeEnum.TENANT,
        scope: savedRequest.scope,
        is_urgent: savedRequest.is_urgent,
      });
    } catch (error) {
      this.logger.error('Failed to emit service.created event:', error);
    }

    return {
      ...savedRequest,
      property_name: tenantExistInProperty.property?.name,
      property_location: tenantExistInProperty.property?.location,
      facility_managers: selected_managers,
    };
  }

  private async createMaintenanceRequestAsFacilityManager(
    data: CreateMaintenanceRequestDto,
    actor: RequestActor,
  ): Promise<any> {
    const scope = data.scope ?? MaintenanceRequestScopeEnum.UNIT;

    const fmTeamMembers = await this.teamMemberRepository.find({
      where: {
        account: { user: { id: actor.id } },
        role: RolesEnum.FACILITY_MANAGER,
      },
      relations: ['account', 'account.user', 'team'],
    });
    if (fmTeamMembers.length === 0) {
      throw new HttpException(
        'You are not registered as a facility manager',
        HttpStatus.FORBIDDEN,
      );
    }

    const fmUser = fmTeamMembers[0].account?.user;
    const fmName = fmUser
      ? `${fmUser.first_name ?? ''} ${fmUser.last_name ?? ''}`.trim() ||
        'Facility Manager'
      : 'Facility Manager';

    if (scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      return this.createCommonAreaRequestAsFacilityManager(
        data,
        actor,
        fmTeamMembers[0],
        fmName,
      );
    }

    // scope === UNIT. FM is authorized iff they're on a team whose creator
    // (the landlord) owns the property. The TeamMember row we self-assign
    // to is the one on the *property owner's* team — an FM may sit on
    // multiple teams.
    const property = await this.propertyRepository.findOne({
      where: { id: data.property_id },
    });
    if (!property) {
      throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
    }
    const assigningTm = fmTeamMembers.find(
      (tm) => tm.team?.creatorId === property.owner_id,
    );
    if (!assigningTm) {
      throw new HttpException(
        'You are not authorized to file requests for this landlord',
        HttpStatus.FORBIDDEN,
      );
    }

    const request = this.maintenanceRequestRepository.create({
      request_id: this.utilService.generateMaintenanceRequestId(),
      tenant_id: null,
      property_id: property.id,
      common_area_id: null,
      tenant_name: '—',
      property_name: property.name,
      issue_category: 'service',
      date_reported: new Date(),
      description: data.text,
      status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      scope,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_user_id: actor.id,
      assigned_to: assigningTm.id,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      actor.id,
      'facility_manager',
      `Maintenance request created by ${fmName}`,
    );

    try {
      this.eventEmitter.emit('maintenance.created', {
        user_id: actor.id,
        property_id: property.id,
        landlord_id: property.owner_id,
        tenant_name: '—',
        property_name: property.name,
        maintenance_request_id: savedRequest.id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
        creator_name: fmName,
        scope: savedRequest.scope,
        is_urgent: savedRequest.is_urgent,
      });
    } catch (error) {
      this.logger.error('Failed to emit service.created event:', error);
    }

    return {
      ...savedRequest,
      property_name: property.name,
      property_location: property.location,
    };
  }

  /**
   * FM creates a request scoped to a specific common area. There's no property
   * involvement here — the FM just needs to be teamed with the common area's
   * landlord (owner_id).
   */
  private async createCommonAreaRequestAsFacilityManager(
    data: CreateMaintenanceRequestDto,
    actor: RequestActor,
    fmTeamMember: TeamMember,
    fmName: string,
  ): Promise<any> {
    const commonArea = await this.commonAreaRepository.findOne({
      where: { id: data.common_area_id },
    });
    if (!commonArea) {
      throw new HttpException(
        'Common area not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const teamedWithOwner = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .innerJoin('team.creator', 'creatorAccount')
      .innerJoin('creatorAccount.user', 'landlordUser')
      .innerJoin('tm.account', 'fmAccount')
      .innerJoin('fmAccount.user', 'fmUser')
      .where('fmUser.id = :fmUserId', { fmUserId: actor.id })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('landlordUser.id = :ownerId', { ownerId: commonArea.owner_id })
      .getOne();
    if (!teamedWithOwner) {
      throw new HttpException(
        "You are not authorized to file requests for this landlord's common areas",
        HttpStatus.FORBIDDEN,
      );
    }

    const request = this.maintenanceRequestRepository.create({
      request_id: this.utilService.generateMaintenanceRequestId(),
      tenant_id: null,
      property_id: null,
      property_name: null,
      common_area_id: commonArea.id,
      tenant_name: '—',
      issue_category: 'service',
      date_reported: new Date(),
      description: data.text,
      status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      scope: MaintenanceRequestScopeEnum.COMMON_AREA,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_user_id: actor.id,
      assigned_to: fmTeamMember.id,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      actor.id,
      'facility_manager',
      `Maintenance request created by ${fmName}`,
    );

    try {
      this.eventEmitter.emit('maintenance.created', {
        user_id: actor.id,
        property_id: null,
        landlord_id: commonArea.owner_id,
        common_area_id: commonArea.id,
        common_area_name: commonArea.name,
        tenant_name: '—',
        property_name: null,
        maintenance_request_id: savedRequest.id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
        creator_name: fmName,
        scope: savedRequest.scope,
        is_urgent: savedRequest.is_urgent,
      });
    } catch (error) {
      this.logger.error('Failed to emit service.created event:', error);
    }

    return {
      ...savedRequest,
      common_area: {
        id: commonArea.id,
        name: commonArea.name,
        address: commonArea.address,
        owner_id: commonArea.owner_id,
      },
    };
  }

  async getAllMaintenanceRequests(
    user_id: string,
    queryParams: MaintenanceRequestFilter,
    role?: string,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const qb = this.maintenanceRequestRepository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      .leftJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('sr.common_area', 'common_area')
      .leftJoinAndSelect('common_area.owner', 'commonAreaOwner')
      .leftJoinAndSelect('sr.statusHistory', 'statusHistory')
      .leftJoinAndSelect('statusHistory.changedBy', 'changedBy')
      .where('sr.deleted_at IS NULL');

    if (role === RolesEnum.FACILITY_MANAGER) {
      const myTeamMemberships = await this.teamMemberRepository.find({
        where: {
          account: { user: { id: user_id } },
          role: RolesEnum.FACILITY_MANAGER,
        },
        relations: ['account', 'account.user', 'team', 'team.creator', 'team.creator.user'],
      });
      if (myTeamMemberships.length === 0) {
        return {
          maintenance_requests: [],
          pagination: {
            totalRows: 0,
            perPage: size,
            currentPage: page,
            totalPages: 0,
            hasNextPage: false,
          },
        };
      }
      const landlordAccountIds = Array.from(
        new Set(
          myTeamMemberships
            .map((m) => m.team?.creator?.id)
            .filter((v): v is string => !!v),
        ),
      );
      const landlordUserIds = Array.from(
        new Set(
          myTeamMemberships
            .map((m) => m.team?.creator?.user?.id)
            .filter((v): v is string => !!v),
        ),
      );

      // Visible to FM: every unit-scoped request on a property owned by a
      // landlord they're teamed with, OR every common-area request whose
      // common area belongs to such a landlord. FMs are no longer pinned
      // to specific properties.
      qb.andWhere(
        '(property.owner_id IN (:...landlordAccountIds) OR commonAreaOwner.id IN (:...landlordUserIds))',
        {
          landlordAccountIds:
            landlordAccountIds.length > 0 ? landlordAccountIds : ['__none__'],
          landlordUserIds:
            landlordUserIds.length > 0 ? landlordUserIds : ['__none__'],
        },
      );

      // Narrow to "assigned to me" when the caller asks for it. Use the
      // FM's TeamMember ids across all the landlord teams they sit on.
      if (queryParams?.assigned_to === 'me') {
        const tmIds = myTeamMemberships.map((m) => m.id);
        qb.andWhere('sr.assigned_to IN (:...assignedTmIds)', {
          assignedTmIds: tmIds.length > 0 ? tmIds : ['__none__'],
        });
      }
    } else {
      // Landlord view: own properties OR own common areas.
      qb.andWhere(
        '(property.owner_id = :ownerId OR commonAreaOwner.id = :ownerId)',
        { ownerId: user_id },
      );
    }

    // Explicit assignee UUID filter (any role). Useful for landlord views
    // that want to filter their SRs by which FM is handling them.
    if (
      queryParams?.assigned_to &&
      queryParams.assigned_to !== 'me'
    ) {
      qb.andWhere('sr.assigned_to = :assignedToId', {
        assignedToId: queryParams.assigned_to,
      });
    }

    if (queryParams?.status) {
      qb.andWhere('sr.status = :status', { status: queryParams.status });
    }
    if (queryParams?.scope) {
      qb.andWhere('sr.scope = :scope', { scope: queryParams.scope });
    }
    if (queryParams?.creator_type) {
      qb.andWhere('sr.creator_type = :creator_type', {
        creator_type: queryParams.creator_type,
      });
    }
    if (queryParams?.is_urgent !== undefined) {
      qb.andWhere('sr.is_urgent = :is_urgent', {
        is_urgent: queryParams.is_urgent,
      });
    }
    if (queryParams?.tenant_id) {
      qb.andWhere('sr.tenant_id = :tenant_id', {
        tenant_id: queryParams.tenant_id,
      });
    }
    if (queryParams?.property_id) {
      qb.andWhere('sr.property_id = :property_id', {
        property_id: queryParams.property_id,
      });
    }
    if (queryParams?.common_area_id) {
      qb.andWhere('sr.common_area_id = :common_area_id', {
        common_area_id: queryParams.common_area_id,
      });
    }
    if (queryParams?.start_date) {
      qb.andWhere('sr.date_reported >= :start_date', {
        start_date: queryParams.start_date,
      });
    }
    if (queryParams?.end_date) {
      qb.andWhere('sr.date_reported <= :end_date', {
        end_date: queryParams.end_date,
      });
    }

    qb.orderBy('sr.created_at', 'DESC')
      .addOrderBy('statusHistory.changed_at', 'ASC')
      .skip(skip)
      .take(size);

    const [maintenanceRequests, count] = await qb.getManyAndCount();

    const totalPages = Math.ceil(count / size);
    return {
      maintenance_requests: maintenanceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getMaintenanceRequestById(id: string, userId: string): Promise<any> {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: [
        'tenant',
        'tenant.user',
        'creator',
        'property',
        'common_area',
        'common_area.owner',
        'statusHistory',
        'statusHistory.changedBy',
      ],
      order: {
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });
    if (!maintenanceRequest?.id) {
      throw new HttpException(
        `Maintenance request with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    await this.assertCanRead(maintenanceRequest, userId);
    return maintenanceRequest;
  }

  async getMaintenanceRequestByTenant(id: string, status?: string) {
    const statuses = Array.isArray(status)
      ? status
      : status
        ? [status]
        : [
            MaintenanceRequestStatusEnum.NOT_APPROVED,
            MaintenanceRequestStatusEnum.APPROVED,
            MaintenanceRequestStatusEnum.RESOLVED,
            MaintenanceRequestStatusEnum.REOPENED,
          ];

    return this.maintenanceRequestRepository.find({
      where: {
        tenant_id: id,
        status: In(statuses),
      },
      relations: [
        'tenant',
        'tenant.user',
        'creator',
        'property',
        'common_area',
        'common_area.owner',
        'statusHistory',
        'statusHistory.changedBy',
      ],
      order: {
        created_at: 'DESC',
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });
  }

  async updateMaintenanceRequestById(
    id: string,
    data: UpdateMaintenanceRequestResponseDto,
    userId: string,
  ) {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });
    if (!maintenanceRequest) {
      throw new HttpException(
        'Maintenance request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const actorRole = await this.resolveActorRole(maintenanceRequest, userId);
    if (!actorRole) {
      throw new HttpException(
        'You do not have permission to update this maintenance request',
        HttpStatus.FORBIDDEN,
      );
    }

    const previousStatus = maintenanceRequest.status;
    const targetStatus = data.status;

    // Validate status transition (if any) before mutating anything else. The
    // REOPENED→REOPENED self-loop is the race case (both FM and tenant try to
    // reopen) — it's allowed by the state machine but handled below as an
    // additional history-only entry, with no entity mutation.
    if (targetStatus !== undefined && targetStatus !== previousStatus) {
      this.assertValidStatusTransition(
        previousStatus,
        targetStatus,
        actorRole,
        maintenanceRequest.creator_type,
        data.reopen_message,
      );
    }
    const isReopenSelfLoop =
      targetStatus === MaintenanceRequestStatusEnum.REOPENED &&
      previousStatus === MaintenanceRequestStatusEnum.REOPENED;
    if (isReopenSelfLoop) {
      this.assertValidStatusTransition(
        previousStatus,
        targetStatus,
        actorRole,
        maintenanceRequest.creator_type,
        data.reopen_message,
      );
    }

    // is_urgent toggle is landlord-only.
    if (
      data.is_urgent !== undefined &&
      data.is_urgent !== maintenanceRequest.is_urgent &&
      actorRole !== 'landlord'
    ) {
      throw new HttpException(
        'Only the landlord can change the urgent flag',
        HttpStatus.FORBIDDEN,
      );
    }

    // Resolve transitions require a summary + category — those columns hold
    // the data the FM enters in the ResolutionModal.
    if (
      targetStatus === MaintenanceRequestStatusEnum.RESOLVED &&
      previousStatus !== MaintenanceRequestStatusEnum.RESOLVED
    ) {
      if (!data.resolution_summary || !data.resolution_summary.trim()) {
        throw new HttpException(
          'resolution_summary is required when marking a request as resolved',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!data.resolution_category) {
        throw new HttpException(
          'resolution_category is required when marking a request as resolved',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // ── Race-case short-circuit ────────────────────────────────────────────
    // First-write-won. Don't mutate the entity; just append a history row
    // capturing this caller's reopen_message so both voices are preserved.
    if (isReopenSelfLoop) {
      await this.appendReopenNoteWithDedup(
        id,
        userId,
        actorRole,
        data.reopen_message ?? '',
      );
      const refreshed = await this.maintenanceRequestRepository.findOne({
        where: { id },
        relations: ['property'],
      });
      return { ...(refreshed as MaintenanceRequest), alreadyReopened: true };
    }

    const safeUpdate: Partial<MaintenanceRequest> = {};
    if (targetStatus !== undefined) safeUpdate.status = targetStatus;
    if (data.is_urgent !== undefined) safeUpdate.is_urgent = data.is_urgent;
    if (data.description !== undefined)
      safeUpdate.description = data.description;
    if (data.issue_category !== undefined)
      safeUpdate.issue_category = data.issue_category;
    if (data.date_reported !== undefined)
      safeUpdate.date_reported = data.date_reported;
    if (data.resolution_date !== undefined)
      safeUpdate.resolution_date = data.resolution_date;
    if (data.issue_images !== undefined)
      safeUpdate.issue_images = data.issue_images;

    if (targetStatus === MaintenanceRequestStatusEnum.RESOLVED) {
      safeUpdate.resolution_date = new Date();
      safeUpdate.resolvedAt = new Date();
      safeUpdate.resolution_summary = data.resolution_summary;
      safeUpdate.resolution_category = data.resolution_category;
      safeUpdate.resolution_cost_minor =
        data.resolution_cost_minor ?? null;
    }
    if (targetStatus === MaintenanceRequestStatusEnum.REOPENED) {
      safeUpdate.reopened_at = new Date();
    }

    if (Object.keys(safeUpdate).length > 0) {
      await this.maintenanceRequestRepository.update(id, safeUpdate);
    }

    const updatedMaintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });

    if (targetStatus && targetStatus !== previousStatus) {
      const reasonParts: string[] = [
        `Status updated via API from ${previousStatus} to ${targetStatus}`,
      ];
      if (
        targetStatus === MaintenanceRequestStatusEnum.REOPENED &&
        data.reopen_message
      ) {
        reasonParts.push(`Reopen reason: ${data.reopen_message}`);
      }
      await this.createStatusHistoryEntry(
        id,
        previousStatus,
        targetStatus,
        userId,
        actorRole,
        reasonParts.join(' — '),
        data.reopen_message,
      );
    }

    if (
      updatedMaintenanceRequest &&
      (targetStatus || data.description || data.is_urgent !== undefined)
    ) {
      this.eventEmitter.emit('maintenance.updated', {
        request_id: updatedMaintenanceRequest.id,
        status: updatedMaintenanceRequest.status,
        previous_status: previousStatus,
        is_urgent: updatedMaintenanceRequest.is_urgent,
        tenant_name: updatedMaintenanceRequest.tenant_name,
        property_name: updatedMaintenanceRequest.property_name,
        property_id: updatedMaintenanceRequest.property_id,
        common_area_id: updatedMaintenanceRequest.common_area_id,
        common_area_name: updatedMaintenanceRequest.common_area?.name ?? null,
        landlord_id:
          updatedMaintenanceRequest.property?.owner_id ??
          updatedMaintenanceRequest.common_area?.owner_id ??
          null,
        tenant_id: updatedMaintenanceRequest.tenant_id,
        creator_type: updatedMaintenanceRequest.creator_type,
        creator_user_id: updatedMaintenanceRequest.creator_user_id,
        description: updatedMaintenanceRequest.description,
        updated_at: new Date(),
        actor: { id: userId, role: actorRole },
      });
    }

    return updatedMaintenanceRequest;
  }

  /**
   * Records a "reopen note" history row for a request that's already in the
   * REOPENED state. Skips the insert if the same user submitted the same
   * reopen_message within the last 2 seconds — defends against double-clicks
   * on the FE.
   */
  private async appendReopenNoteWithDedup(
    maintenanceRequestId: string,
    userId: string,
    actorRole: 'landlord' | 'tenant' | 'facility_manager',
    reopenMessage: string,
  ): Promise<void> {
    const recent = await this.statusHistoryRepository
      .createQueryBuilder('h')
      .where('h.maintenance_request_id = :id', { id: maintenanceRequestId })
      .andWhere('h.changed_by_user_id = :userId', { userId })
      .andWhere('h.notes = :notes', { notes: reopenMessage })
      .andWhere(`h.changed_at > NOW() - INTERVAL '2 seconds'`)
      .getOne();
    if (recent) return;

    await this.createStatusHistoryEntry(
      maintenanceRequestId,
      MaintenanceRequestStatusEnum.REOPENED,
      MaintenanceRequestStatusEnum.REOPENED,
      userId,
      actorRole,
      'additional_reopen_note',
      reopenMessage,
    );
  }

  async deleteMaintenanceRequestById(id: string, userId: string) {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });
    if (!maintenanceRequest) {
      throw new HttpException(
        'Maintenance request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const landlordUserId =
      maintenanceRequest.property?.owner_id ??
      maintenanceRequest.common_area?.owner_id ??
      null;
    if (
      maintenanceRequest.tenant_id !== userId &&
      maintenanceRequest.creator_user_id !== userId &&
      landlordUserId !== userId
    ) {
      throw new HttpException(
        'You do not have permission to delete this maintenance request',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.maintenanceRequestRepository.softDelete(id);
  }

  async getPendingAndUrgentRequests(
    queryParams: MaintenanceRequestFilter,
    owner_id: string,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildMaintenanceRequestFilter(queryParams);

    // "Needs attention": still awaiting landlord approval OR flagged urgent
    // (regardless of where it sits in the lifecycle). Owned via property OR
    // via common_area — common-area requests carry no property at all.
    const [maintenanceRequests, count] = await this.maintenanceRequestRepository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      .leftJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('sr.common_area', 'common_area')
      .leftJoinAndSelect('common_area.owner', 'commonAreaOwner')
      .leftJoinAndSelect('sr.statusHistory', 'history')
      .leftJoinAndSelect('history.changedBy', 'changedBy')
      .where(
        '(property.owner_id = :owner_id OR commonAreaOwner.id = :owner_id)',
        { owner_id },
      )
      .andWhere('(sr.status = :notApproved OR sr.is_urgent = :urgent)', {
        notApproved: MaintenanceRequestStatusEnum.NOT_APPROVED,
        urgent: true,
      })
      .andWhere(query?.['status'] ? 'sr.status = :statusFilter' : '1=1', {
        statusFilter: query?.['status'],
      })
      .orderBy('sr.created_at', 'DESC')
      .skip(skip)
      .take(size)
      .getManyAndCount();

    const totalPages = Math.ceil(count / size);
    return {
      maintenance_requests: maintenanceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getMaintenanceRequestsByTenant(
    tenant_id: string,
    queryParams: MaintenanceRequestFilter,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;
    const [maintenanceRequests, count] =
      await this.maintenanceRequestRepository.findAndCount({
        where: {
          tenant_id,
        },
        relations: [
          'tenant',
          'tenant.user',
          'creator',
          'property',
          'statusHistory',
          'statusHistory.changedBy',
        ],
        skip,
        take: size,
        order: {
          created_at: 'DESC',
          statusHistory: {
            changed_at: 'ASC',
          },
        },
      });
    const totalPages = Math.ceil(count / size);
    return {
      maintenance_requests: maintenanceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getRequestById(id: string): Promise<MaintenanceRequest> {
    const request = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['messages', 'statusHistory', 'statusHistory.changedBy'],
      order: {
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Maintenance request not found');
    }

    return request;
  }

  /**
   * Returns the audit trail for a request: who transitioned it, when, why.
   * Permission set matches getMaintenanceRequestById — caller must be landlord,
   * tenant on the request, the creator, or the assigned FM.
   */
  async getStatusHistory(id: string, userId: string) {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });
    if (!maintenanceRequest) {
      throw new HttpException(
        'Maintenance request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.assertCanRead(maintenanceRequest, userId);

    return this.statusHistoryRepository.find({
      where: { maintenance_request_id: id },
      relations: ['changedBy'],
      order: { changed_at: 'ASC' },
    });
  }

  /**
   * Activity feed for a facility manager: every status_history row across
   * every maintenance request on properties the FM manages, ordered DESC by
   * changed_at. Includes the creation event (history rows with
   * previous_status IS NULL).
   *
   * Cursor pagination on (changed_at, id) — pass the last seen pair back as
   * `cursor` to fetch the next page. Defends against duplicate rows when new
   * activity is inserted while the user is paginating.
   */
  async getActivityFeedForFacilityManager(
    userId: string,
    options?: {
      cursor?: { changed_at: string; id: string };
      size?: number;
      landlordId?: string;
    },
  ) {
    const size = Math.min(Math.max(options?.size ?? 20, 1), 100);

    const teamMemberships = await this.teamMemberRepository.find({
      where: {
        account: { user: { id: userId } },
        role: RolesEnum.FACILITY_MANAGER,
      },
      relations: [
        'account',
        'account.user',
        'team',
        'team.creator',
        'team.creator.user',
      ],
    });
    if (teamMemberships.length === 0) {
      return { items: [], pagination: { nextCursor: null, hasNextPage: false } };
    }
    const landlordAccountIds = Array.from(
      new Set(
        teamMemberships
          .map((tm) => tm.team?.creator?.id)
          .filter((v): v is string => !!v),
      ),
    );
    const landlordUserIds = Array.from(
      new Set(
        teamMemberships
          .map((tm) => tm.team?.creator?.user?.id)
          .filter((v): v is string => !!v),
      ),
    );

    const qb = this.statusHistoryRepository
      .createQueryBuilder('h')
      .innerJoinAndSelect('h.maintenanceRequest', 'sr')
      .leftJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('sr.common_area', 'common_area')
      .leftJoinAndSelect('common_area.owner', 'commonAreaOwner')
      .leftJoinAndSelect('h.changedBy', 'actor')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      .where(
        '(property.owner_id IN (:...landlordAccountIds) OR commonAreaOwner.id IN (:...landlordUserIds))',
        {
          landlordAccountIds:
            landlordAccountIds.length > 0 ? landlordAccountIds : ['__none__'],
          landlordUserIds:
            landlordUserIds.length > 0 ? landlordUserIds : ['__none__'],
        },
      )
      .andWhere('sr.deleted_at IS NULL');

    if (options?.landlordId) {
      // `landlordId` is the landlord's Account.id (matches property.owner_id).
      // For common-area scope we need the landlord's User.id to compare
      // against commonAreaOwner.id — resolve it from the FM's team data,
      // which is already loaded.
      const filterUserId =
        teamMemberships.find(
          (tm) => tm.team?.creator?.id === options.landlordId,
        )?.team?.creator?.user?.id ?? null;
      qb.andWhere(
        '(property.owner_id = :landlordAccountId OR commonAreaOwner.id = :landlordUserId)',
        {
          landlordAccountId: options.landlordId,
          landlordUserId: filterUserId ?? '__none__',
        },
      );
    }

    if (options?.cursor) {
      qb.andWhere(
        '(h.changed_at, h.id) < (:cursorChangedAt, :cursorId)',
        {
          cursorChangedAt: options.cursor.changed_at,
          cursorId: options.cursor.id,
        },
      );
    }

    const rows = await qb
      .orderBy('h.changed_at', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .take(size + 1)
      .getMany();

    const hasNextPage = rows.length > size;
    const trimmed = hasNextPage ? rows.slice(0, size) : rows;
    const nextCursor = hasNextPage
      ? {
          changed_at: trimmed[trimmed.length - 1].changed_at.toISOString(),
          id: trimmed[trimmed.length - 1].id,
        }
      : null;

    const titleByEvent: Record<string, string> = {
      created: 'Issue reported',
      approved: 'Approved by landlord',
      resolved: 'Issue marked as resolved',
      reopened: 'Issue reopened',
      reopen_note: 'Additional reopen note',
      closed: 'Issue closed',
      not_approved: 'Issue reported',
    };
    const fullName = (f?: string | null, l?: string | null) =>
      [f, l].filter(Boolean).join(' ') || null;

    const items = trimmed.map((h) => {
      const sr = h.maintenanceRequest;
      const isCreation = h.previous_status === null;
      const isReopenNote =
        h.previous_status === MaintenanceRequestStatusEnum.REOPENED &&
        h.new_status === MaintenanceRequestStatusEnum.REOPENED;

      const event_type = isCreation
        ? 'created'
        : isReopenNote
          ? 'reopen_note'
          : (h.new_status as string);

      const title = titleByEvent[event_type] ?? `Status: ${h.new_status}`;
      const description = isCreation
        ? sr.description
        : h.notes || h.change_reason || '';

      const actor_name =
        fullName(h.changedBy?.first_name, h.changedBy?.last_name) ||
        fullName(sr.tenant?.user?.first_name, sr.tenant?.user?.last_name) ||
        fullName(sr.creator?.first_name, sr.creator?.last_name) ||
        sr.tenant_name ||
        '—';

      return {
        id: h.id,
        event_type,
        title,
        description,
        request_id: sr.id,
        request_ref: sr.request_id,
        property_id: sr.property?.id ?? null,
        property_name: sr.property?.name ?? null,
        common_area_id: sr.common_area?.id ?? null,
        common_area_name: sr.common_area?.name ?? null,
        landlord_id:
          sr.property?.owner_id ?? sr.common_area?.owner_id ?? null,
        actor_name,
        actor_role: h.changed_by_role,
        scope: sr.scope,
        creator_type: sr.creator_type,
        current_status: sr.status,
        changed_at: h.changed_at,
      };
    });

    return {
      items,
      pagination: { nextCursor, hasNextPage },
    };
  }

  /**
   * Resolves the requesting user's effective role for a given request, used
   * to gate transitions and writes. Returns null if the user has no claim.
   */
  private async resolveActorRole(
    maintenanceRequest: MaintenanceRequest,
    userId: string,
  ): Promise<'landlord' | 'tenant' | 'facility_manager' | null> {
    const landlordUserId =
      maintenanceRequest.property?.owner_id ??
      maintenanceRequest.common_area?.owner_id ??
      null;

    if (landlordUserId && landlordUserId === userId) return 'landlord';
    if (
      maintenanceRequest.tenant_id &&
      (await this.isTenantUser(maintenanceRequest, userId))
    ) {
      return 'tenant';
    }
    if (maintenanceRequest.creator_user_id === userId) {
      // Creator might be the FM who reported it; FM-as-creator gets the
      // facility_manager role for transitions on their own request.
      return maintenanceRequest.creator_type ===
        MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER
        ? 'facility_manager'
        : 'tenant';
    }
    if (!landlordUserId) return null;

    // FM teamed with the landlord that owns the property or common area.
    const fm = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .innerJoin('team.creator', 'creatorAccount')
      .innerJoin('creatorAccount.user', 'landlordUser')
      .innerJoin('tm.account', 'fmAccount')
      .innerJoin('fmAccount.user', 'fmUser')
      .where('fmUser.id = :userId', { userId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('landlordUser.id = :landlordUserId', { landlordUserId })
      .getOne();
    return fm ? 'facility_manager' : null;
  }

  private async isTenantUser(
    maintenanceRequest: MaintenanceRequest,
    userId: string,
  ): Promise<boolean> {
    if (!maintenanceRequest.tenant_id) return false;
    // tenant_id holds Account.id; resolve to user via tenant relation.
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: maintenanceRequest.id },
      relations: ['tenant', 'tenant.user'],
    });
    return sr?.tenant?.user?.id === userId;
  }

  private async assertCanRead(
    maintenanceRequest: MaintenanceRequest,
    userId: string,
  ): Promise<void> {
    const role = await this.resolveActorRole(maintenanceRequest, userId);
    if (!role) {
      throw new HttpException(
        'You do not have permission to view this maintenance request',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Enforces the lifecycle: not_approved → approved → resolved →
   * (closed | reopened → resolved → ...). Role policy:
   *   - landlord ONLY approves (NOT_APPROVED → APPROVED). No other transitions.
   *   - FM-on-this-property handles approve→resolve, reopen→resolve, and
   *     resolve→reopen on any request on the property regardless of creator.
   *   - tenant can confirm-resolution (RESOLVED → CLOSED) and reject-resolution
   *     (RESOLVED → REOPENED) on requests they filed.
   *   - REOPENED → REOPENED is permitted as a self-loop carrying an additional
   *     reopen_message (race case where FM and tenant both reopen). The caller
   *     in updateMaintenanceRequestById skips the entity mutation and only logs a
   *     history row in that case.
   */
  private assertValidStatusTransition(
    from: MaintenanceRequestStatusEnum,
    to: MaintenanceRequestStatusEnum,
    actorRole: 'landlord' | 'tenant' | 'facility_manager',
    creatorType: MaintenanceRequestCreatorTypeEnum,
    reopenMessage?: string,
  ): void {
    const transition = `${from}->${to}`;
    const tenantIsCreator =
      creatorType === MaintenanceRequestCreatorTypeEnum.TENANT;
    const fmIsCreator =
      creatorType === MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER;

    switch (transition) {
      case `${MaintenanceRequestStatusEnum.NOT_APPROVED}->${MaintenanceRequestStatusEnum.APPROVED}`:
        if (actorRole !== 'landlord') {
          throw new HttpException(
            'Only the landlord can approve a maintenance request',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      case `${MaintenanceRequestStatusEnum.APPROVED}->${MaintenanceRequestStatusEnum.RESOLVED}`:
      case `${MaintenanceRequestStatusEnum.REOPENED}->${MaintenanceRequestStatusEnum.RESOLVED}`:
        if (actorRole !== 'facility_manager') {
          throw new HttpException(
            'Only the assigned facility manager can mark this request as resolved',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      case `${MaintenanceRequestStatusEnum.RESOLVED}->${MaintenanceRequestStatusEnum.CLOSED}`: {
        const allowed =
          (tenantIsCreator && actorRole === 'tenant') ||
          (fmIsCreator && actorRole === 'facility_manager');
        if (!allowed) {
          throw new HttpException(
            `Only the original ${tenantIsCreator ? 'tenant' : 'facility manager'} who filed this request can close it`,
            HttpStatus.FORBIDDEN,
          );
        }
        return;
      }

      case `${MaintenanceRequestStatusEnum.RESOLVED}->${MaintenanceRequestStatusEnum.REOPENED}`:
      case `${MaintenanceRequestStatusEnum.REOPENED}->${MaintenanceRequestStatusEnum.REOPENED}`: {
        const allowed =
          actorRole === 'facility_manager' ||
          (tenantIsCreator && actorRole === 'tenant');
        if (!allowed) {
          throw new HttpException(
            'Only the tenant who filed this request or the assigned facility manager can reopen it',
            HttpStatus.FORBIDDEN,
          );
        }
        if (!reopenMessage || !reopenMessage.trim()) {
          throw new HttpException(
            'A reopen_message is required when reopening a resolved request',
            HttpStatus.BAD_REQUEST,
          );
        }
        return;
      }

      default:
        throw new HttpException(
          `Invalid status transition: ${from} → ${to}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  async updateStatus(
    id: string,
    status: MaintenanceRequestStatusEnum,
    notes?: string,
    actor?: { id?: string; role?: string; name?: string },
  ) {
    const request = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['tenant', 'property', 'common_area'],
    });
    if (!request) throw new NotFoundException('Request not found');

    const previousStatus = request.status;
    request.status = status;
    if (notes) request.notes = notes;
    if (status === MaintenanceRequestStatusEnum.RESOLVED)
      request.resolution_date = new Date();
    if (status === MaintenanceRequestStatusEnum.REOPENED)
      request.reopened_at = new Date();

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    if (actor?.id) {
      await this.createStatusHistoryEntry(
        savedRequest.id,
        previousStatus,
        status,
        actor.id,
        actor.role || 'system',
        `Status changed from ${previousStatus} to ${status}`,
        notes,
      );
    } else {
      this.logger.warn(
        `Status history entry skipped for request ${savedRequest.id}: no actor.id provided (${previousStatus} → ${status})`,
      );
    }

    this.eventEmitter.emit('maintenance.updated', {
      request_id: savedRequest.id,
      status: savedRequest.status,
      previous_status: previousStatus,
      is_urgent: savedRequest.is_urgent,
      tenant_name: request.tenant_name,
      property_name: request.property_name,
      property_id: request.property_id,
      common_area_id: request.common_area_id,
      common_area_name: request.common_area?.name ?? null,
      landlord_id:
        request.property?.owner_id ?? request.common_area?.owner_id ?? null,
      tenant_id: request.tenant_id,
      creator_type: request.creator_type,
      creator_user_id: request.creator_user_id,
      description: request.description,
      updated_at: new Date(),
      actor,
    });

    return savedRequest;
  }

  private async createStatusHistoryEntry(
    maintenanceRequestId: string,
    previousStatus: MaintenanceRequestStatusEnum | null,
    newStatus: MaintenanceRequestStatusEnum,
    changedByUserId: string,
    changedByRole: string,
    changeReason?: string,
    notes?: string,
  ): Promise<MaintenanceRequestStatusHistory> {
    const historyEntry = this.statusHistoryRepository.create({
      maintenance_request_id: maintenanceRequestId,
      previous_status: previousStatus,
      new_status: newStatus,
      changed_by_user_id: changedByUserId,
      changed_by_role: changedByRole,
      change_reason: changeReason,
      notes: notes,
      changed_at: new Date(),
    });

    return await this.statusHistoryRepository.save(historyEntry);
  }

  /**
   * Landlord assigns / reassigns / unassigns the FM handling a request.
   * The assignee (if any) must be a FACILITY_MANAGER team_member on the
   * caller's own team. Writes a status-history row capturing the change.
   * No-ops when the new assignee equals the current one.
   */
  async setAssignee(
    requestId: string,
    teamMemberId: string | null,
    landlordAccountId: string,
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }

    const ownerAccountId =
      sr.property?.owner_id ?? sr.common_area?.owner_id ?? null;
    if (ownerAccountId !== landlordAccountId) {
      throw new HttpException(
        'You do not own this request',
        HttpStatus.FORBIDDEN,
      );
    }

    if (teamMemberId) {
      const tm = await this.teamMemberRepository.findOne({
        where: { id: teamMemberId },
        relations: ['team'],
      });
      if (!tm) {
        throw new HttpException(
          'Facility manager not found',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (tm.team?.creatorId !== landlordAccountId) {
        throw new HttpException(
          'Assignee must be a facility manager on your team',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (tm.role !== RolesEnum.FACILITY_MANAGER) {
        throw new HttpException(
          'Assignee must be a facility manager',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    const previousAssignee = sr.assigned_to ?? null;
    if (previousAssignee === teamMemberId) {
      return sr;
    }

    await this.maintenanceRequestRepository.update(requestId, {
      assigned_to: teamMemberId as any,
    });

    // Record the change in status-history. This is not a status transition —
    // we keep prev_status === new_status and lean on `change_reason` for the
    // audit-trail rendering.
    await this.createStatusHistoryEntry(
      requestId,
      sr.status,
      sr.status,
      landlordAccountId,
      'landlord',
      `assignee_changed: ${previousAssignee ?? 'unassigned'} → ${teamMemberId ?? 'unassigned'}`,
    );

    try {
      this.eventEmitter.emit('maintenance.assigned', {
        maintenance_request_id: requestId,
        request_id: sr.request_id,
        previous_assignee: previousAssignee,
        new_assignee: teamMemberId,
        landlord_id: landlordAccountId,
        property_id: sr.property_id,
        common_area_id: sr.common_area_id,
      });
    } catch (error) {
      this.logger.error('Failed to emit service.assigned event:', error);
    }

    return this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'facilityManager'],
    }) as Promise<MaintenanceRequest>;
  }

  /**
   * Every FM on the landlord's team. Used for stakeholder fan-out when a
   * maintenance request is filed (or any other property-level event that
   * should notify the whole team rather than a single per-property FM).
   */
  async findTeamFmsForLandlord(
    landlordAccountId: string,
  ): Promise<TeamMember[]> {
    return this.teamMemberRepository
      .createQueryBuilder('tm')
      .leftJoinAndSelect('tm.account', 'account')
      .leftJoinAndSelect('account.user', 'user')
      .innerJoin('tm.team', 'team')
      .where('team.creatorId = :landlordAccountId', { landlordAccountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getMany();
  }
}
