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
import { DataSource, EntityManager, In, Repository } from 'typeorm';
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
import { Account } from 'src/users/entities/account.entity';
import { ArtisansService } from 'src/artisans/artisans.service';

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
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly utilService: UtilService,
    private readonly artisansService: ArtisansService,
  ) {}

  /**
   * JWT sessions carry `account.id` as `req.user.id`. The status-history table's
   * `changed_by_user_id` column is FK'd to `users.id`, not `accounts.id`, so
   * inserting account.id directly triggers a 23503 FK violation that the
   * exception filter surfaces as a 400 "Invalid reference". Every dashboard
   * write path must resolve account → user.id before writing history.
   *
   * WhatsApp flows already pass `tenant.user.id` / `account.user.id` directly
   * so they bypass this helper.
   */
  private formatTeamMemberLabel(tm: TeamMember | null | undefined): string {
    if (!tm) return 'unassigned';
    const u = tm.account?.user;
    const name = u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '';
    return name || tm.email || 'Facility Manager';
  }

  private async resolveActorUserId(accountId: string): Promise<string> {
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
      relations: ['user'],
    });
    if (!account?.user?.id) {
      throw new HttpException(
        'Could not resolve current user for audit log',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return account.user.id;
  }

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
        account: { id: actor.id },
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
    // creator_user_id is FK'd to users.id, not accounts.id. actor.id is the
    // Account.id from the JWT, so we must use the FM's User.id here.
    if (!fmUser?.id) {
      throw new HttpException(
        'Could not resolve facility manager user',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const fmUserId = fmUser.id;

    if (scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      return this.createCommonAreaRequestAsFacilityManager(
        data,
        actor,
        fmName,
        fmUserId,
      );
    }

    // scope === UNIT. FM is authorized iff they're on a team whose creator
    // (the landlord) owns the property. An FM may sit on multiple teams; we
    // pick the membership matching this property's owner only to validate
    // authorization — we do NOT auto-assign to it anymore (assignment
    // happens later at landlord approval, after the tenant gate).
    const property = await this.propertyRepository.findOne({
      where: { id: data.property_id },
    });
    if (!property) {
      throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
    }
    const authorizingTm = fmTeamMembers.find(
      (tm) => tm.team?.creatorId === property.owner_id,
    );
    if (!authorizingTm) {
      throw new HttpException(
        'You are not authorized to file requests for this landlord',
        HttpStatus.FORBIDDEN,
      );
    }

    // Resolve the active tenancy for this property. The expected invariant
    // is one active tenant per property; we defend against bad data on
    // either side. Three branches:
    //   - exactly one  → gate the MR on tenant confirmation.
    //   - zero (vacant) → skip the gate and go straight to NOT_APPROVED so
    //                     the FM can still file (between-tenant repairs).
    //   - multiple     → 422; resolve the bad data before filing.
    const activeTenancies = await this.propertyTenantRepository.find({
      where: {
        property_id: property.id,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['tenant', 'tenant.user'],
    });

    if (activeTenancies.length > 1) {
      throw new HttpException(
        'Multiple active tenancies on this property; resolve before filing',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const tenancy = activeTenancies[0] ?? null;
    const tenantUser = tenancy?.tenant?.user ?? null;
    const tenantAccountId = tenancy?.tenant?.id ?? null;
    const tenantDisplayName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim() ||
        null
      : null;

    const initialStatus = tenancy
      ? MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION
      : MaintenanceRequestStatusEnum.NOT_APPROVED;

    const request = this.maintenanceRequestRepository.create({
      request_id: this.utilService.generateMaintenanceRequestId(),
      tenant_id: tenantAccountId,
      property_id: property.id,
      common_area_id: null,
      tenant_name: tenantDisplayName,
      property_name: property.name,
      issue_category: 'service',
      date_reported: new Date(),
      description: data.text,
      status: initialStatus,
      scope,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_user_id: fmUserId,
      assigned_to: null,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      initialStatus,
      fmUserId,
      'facility_manager',
      `Maintenance request created by ${fmName}`,
    );

    const basePayload = {
      user_id: actor.id,
      property_id: property.id,
      landlord_id: property.owner_id,
      tenant_id: tenantAccountId,
      tenant_name: tenantDisplayName,
      tenant_phone_number: tenantUser?.phone_number ?? null,
      property_name: property.name,
      property_location: property.location,
      maintenance_request_id: savedRequest.id,
      request_id: savedRequest.request_id,
      description: data.text,
      created_at: savedRequest.created_at,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_name: fmName,
      scope: savedRequest.scope,
      is_urgent: savedRequest.is_urgent,
    };

    try {
      if (tenancy) {
        this.eventEmitter.emit(
          'maintenance.fm_filed_pending_tenant',
          basePayload,
        );
      } else {
        this.eventEmitter.emit('maintenance.created', basePayload);
      }
    } catch (error) {
      this.logger.error('Failed to emit FM-create event:', error);
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
   * landlord (owner_id). No auto-assignment; the landlord picks an assignee
   * at approval time.
   */
  private async createCommonAreaRequestAsFacilityManager(
    data: CreateMaintenanceRequestDto,
    actor: RequestActor,
    fmName: string,
    fmUserId: string,
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

    // actor.id is Account.id; common_area.owner_id is Users.id (per the
    // CommonArea schema), so we resolve the landlord's Users.id via the
    // team creator's user relation and match the FM by account id.
    const teamedWithOwner = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .innerJoin('team.creator', 'creatorAccount')
      .innerJoin('creatorAccount.user', 'landlordUser')
      .where('tm.accountId = :accountId', { accountId: actor.id })
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
      tenant_name: null,
      issue_category: 'service',
      date_reported: new Date(),
      description: data.text,
      status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      scope: MaintenanceRequestScopeEnum.COMMON_AREA,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_user_id: fmUserId,
      assigned_to: null,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      fmUserId,
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
        tenant_id: null,
        tenant_name: null,
        property_name: null,
        maintenance_request_id: savedRequest.id,
        request_id: savedRequest.request_id,
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
      .leftJoinAndSelect('sr.facilityManager', 'facilityManager')
      .leftJoinAndSelect('facilityManager.account', 'facilityManagerAccount')
      .leftJoinAndSelect('sr.statusHistory', 'statusHistory')
      .leftJoinAndSelect('statusHistory.changedBy', 'changedBy')
      .where('sr.deleted_at IS NULL');

    if (role === RolesEnum.FACILITY_MANAGER) {
      const myTeamMemberships = await this.teamMemberRepository.find({
        where: {
          account: { id: user_id },
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

    // Ordering by a joined one-to-many column would force LIMIT onto the
    // join-multiplied row set, truncating pages. Keep order on `sr` only.
    qb.orderBy('sr.created_at', 'DESC').skip(skip).take(size);

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
        // Pull accounts so the activity log can render account.profile_name
        // instead of falling back to user.first_name + last_name.
        'statusHistory.changedBy.accounts',
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
            MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
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
        maintenanceRequest.assigned_to,
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
        maintenanceRequest.assigned_to,
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
      if (!data.artisan_name || !data.artisan_name.trim()) {
        throw new HttpException(
          'artisan_name is required when marking a request as resolved',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!data.artisan_phone || !data.artisan_phone.trim()) {
        throw new HttpException(
          'artisan_phone is required when marking a request as resolved',
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

      // Artisan upsert. Outside the status+history transaction below because
      // the (team_id, phone) unique constraint makes findOrCreate idempotent
      // — safe to re-run on retry. We use the caller's Account to find their
      // team (FM via team_member; landlord via team.creatorId).
      const callerAccount = await this.accountRepository.findOne({
        where: { id: userId },
      });
      if (!callerAccount) {
        throw new HttpException(
          'Unable to resolve caller account for artisan attribution',
          HttpStatus.BAD_REQUEST,
        );
      }
      const teamId =
        await this.artisansService.resolveCallerTeamId(callerAccount);
      const artisan = await this.artisansService.findOrCreateForResolution({
        teamId,
        name: data.artisan_name!,
        phone: data.artisan_phone!,
        createdByAccountId: userId,
        renameIfExists: data.rename_artisan_if_conflict === true,
      });
      safeUpdate.artisan_id = artisan.id;
      safeUpdate.artisan_name_snapshot = data.artisan_name!.trim();
      // Use the canonical phone (post-normalization) so snapshots and
      // artisans.phone always agree, regardless of what the FM typed.
      safeUpdate.artisan_phone_snapshot = artisan.phone;
    }
    if (targetStatus === MaintenanceRequestStatusEnum.REOPENED) {
      safeUpdate.reopened_at = new Date();
    }

    // Resolve user.id once up-front (read-only, fine to do outside the txn).
    // The status-history row's changed_by_user_id FK points at users.id, but
    // `userId` here is the JWT's account.id — see resolveActorUserId.
    const isStatusChange = !!(targetStatus && targetStatus !== previousStatus);
    const actorUserId = isStatusChange
      ? await this.resolveActorUserId(userId)
      : null;

    // Status update + history insert must be atomic — otherwise a failed
    // history insert leaves the entity flipped but the audit trail missing,
    // and the mutation returns an error so the FE never invalidates.
    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(safeUpdate).length > 0) {
        await manager.update(MaintenanceRequest, id, safeUpdate);
      }
      if (isStatusChange) {
        const reasonParts: string[] = [
          `Status updated via Dashboard from ${previousStatus} to ${targetStatus}`,
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
          targetStatus as MaintenanceRequestStatusEnum,
          actorUserId as string,
          actorRole,
          reasonParts.join(' — '),
          data.reopen_message,
          manager,
        );
      }
    });

    const updatedMaintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });

    if (
      updatedMaintenanceRequest &&
      (targetStatus || data.description)
    ) {
      this.eventEmitter.emit('maintenance.updated', {
        request_id: updatedMaintenanceRequest.id,
        status: updatedMaintenanceRequest.status,
        previous_status: previousStatus,
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
        account: { id: userId },
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
      .leftJoinAndSelect('sr.facilityManager', 'assignedFm')
      .leftJoinAndSelect('assignedFm.account', 'assignedFmAccount')
      .leftJoinAndSelect('assignedFmAccount.user', 'assignedFmUser')
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
      pending_tenant_confirmation: 'Issue reported — awaiting tenant confirmation',
      tenant_confirmed: 'Tenant confirmed the issue',
      tenant_denied: 'Tenant denied the report',
      denied_by_tenant: 'Tenant denied the report',
      landlord_force_confirmed: 'Landlord confirmed on tenant’s behalf',
      rejected: 'Rejected by landlord',
    };
    const fullName = (f?: string | null, l?: string | null) =>
      [f, l].filter(Boolean).join(' ') || null;

    const items = trimmed.map((h) => {
      const sr = h.maintenanceRequest;
      const isCreation = h.previous_status === null;
      const isReopenNote =
        h.previous_status === MaintenanceRequestStatusEnum.REOPENED &&
        h.new_status === MaintenanceRequestStatusEnum.REOPENED;
      const isTenantConfirm =
        h.previous_status ===
          MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION &&
        h.new_status === MaintenanceRequestStatusEnum.NOT_APPROVED;
      const isTenantDeny =
        h.previous_status ===
          MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION &&
        h.new_status === MaintenanceRequestStatusEnum.DENIED_BY_TENANT;

      const event_type = isCreation
        ? 'created'
        : isReopenNote
          ? 'reopen_note'
          : isTenantConfirm
            ? h.changed_by_role === 'landlord'
              ? 'landlord_force_confirmed'
              : 'tenant_confirmed'
            : isTenantDeny
              ? 'tenant_denied'
              : (h.new_status as string);

      const title = titleByEvent[event_type] ?? `Status: ${h.new_status}`;
      const eventNote = h.notes || h.change_reason || '';
      const issueDesc = sr.description?.trim() || '';
      const description = isCreation
        ? sr.description
        : issueDesc && eventNote
          ? `${issueDesc} - ${eventNote}`
          : issueDesc || eventNote;

      const actor_name =
        fullName(h.changedBy?.first_name, h.changedBy?.last_name) ||
        fullName(sr.tenant?.user?.first_name, sr.tenant?.user?.last_name) ||
        fullName(sr.creator?.first_name, sr.creator?.last_name) ||
        sr.tenant_name ||
        '—';

      const assignedFmAccount = sr.facilityManager?.account;
      const assigned_fm_name =
        fullName(
          assignedFmAccount?.user?.first_name,
          assignedFmAccount?.user?.last_name,
        ) ||
        assignedFmAccount?.profile_name ||
        null;

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
        assigned_fm_name,
        assigned_fm_team_member_id: sr.facilityManager?.id ?? null,
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
    // `userId` is the requester's Account.id (set by JwtAuthGuard, which
    // resolves the JWT payload to the full Account entity).
    //
    // The two scopes store owner ids in different shapes:
    //   property.owner_id      → landlord's Account.id
    //   common_area.owner_id   → landlord's User.id
    // We must match each against the right column.
    const propertyOwnerAccountId = maintenanceRequest.property?.owner_id ?? null;
    const commonAreaOwnerUserId =
      maintenanceRequest.common_area?.owner_id ?? null;

    if (propertyOwnerAccountId && propertyOwnerAccountId === userId) {
      return 'landlord';
    }
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
    if (!propertyOwnerAccountId && !commonAreaOwnerUserId) return null;

    // FM teamed with the landlord that owns the property or common area.
    // Match the requester by Account.id (NOT User.id) and match the landlord
    // by Account.id for properties / User.id for common areas.
    const fmQuery = this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .innerJoin('team.creator', 'creatorAccount')
      .leftJoin('creatorAccount.user', 'landlordUser')
      .innerJoin('tm.account', 'fmAccount')
      .where('fmAccount.id = :userId', { userId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER });

    if (propertyOwnerAccountId) {
      fmQuery.andWhere('creatorAccount.id = :ownerId', {
        ownerId: propertyOwnerAccountId,
      });
    } else {
      fmQuery.andWhere('landlordUser.id = :ownerId', {
        ownerId: commonAreaOwnerUserId,
      });
    }

    const fm = await fmQuery.getOne();
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
   * Enforces the lifecycle:
   *
   *   FM-filed unit (with active tenant):
   *     pending_tenant_confirmation
   *       ├── (tenant confirms)        → not_approved → approved → resolved → ...
   *       └── (tenant denies)          → denied_by_tenant (terminal)
   *
   *   Tenant-filed, or FM-filed common-area / vacant unit:
   *     not_approved → approved → resolved → (closed | reopened → resolved → ...)
   *
   *   Landlord rejection (WhatsApp only):
   *     not_approved → rejected (terminal)
   *
   * Role policy:
   *   - landlord approves (NOT_APPROVED → APPROVED) and rejects via the
   *     dedicated reject path. Landlord can also force-confirm
   *     (PENDING_TENANT_CONFIRMATION → NOT_APPROVED) when the tenant is
   *     unresponsive — same destination as a tenant-confirm but recorded as
   *     a landlord-actor in status_history.
   *   - tenant on the request confirms or denies the FM-filed gate
   *     (PENDING_TENANT_CONFIRMATION → NOT_APPROVED | DENIED_BY_TENANT) and
   *     can confirm-resolution (RESOLVED → CLOSED) or reject-resolution
   *     (RESOLVED → REOPENED) on requests they filed.
   *   - FM-on-this-property handles approve→resolve, reopen→resolve, and
   *     resolve→reopen on any request on the property regardless of creator.
   *   - REOPENED → REOPENED is permitted as a self-loop carrying an additional
   *     reopen_message (race case where FM and tenant both reopen). The caller
   *     in updateMaintenanceRequestById skips the entity mutation and only logs a
   *     history row in that case.
   *
   * Terminal states: closed, rejected, denied_by_tenant.
   */
  private assertValidStatusTransition(
    from: MaintenanceRequestStatusEnum,
    to: MaintenanceRequestStatusEnum,
    actorRole: 'landlord' | 'tenant' | 'facility_manager',
    creatorType: MaintenanceRequestCreatorTypeEnum,
    reopenMessage?: string,
    assignedTo?: string | null,
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
        if (!assignedTo) {
          throw new HttpException(
            'Assign a facility manager before approving',
            HttpStatus.BAD_REQUEST,
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

      // FM-filed unit-scoped MRs sit in PENDING_TENANT_CONFIRMATION until the
      // tenant responds. The dedicated endpoints (`/tenant-confirm`,
      // `/tenant-deny`, `/landlord-force-confirm`) are the primary path —
      // these cases let the generic PUT also reach the same transitions.
      case `${MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION}->${MaintenanceRequestStatusEnum.NOT_APPROVED}`:
        if (actorRole !== 'tenant' && actorRole !== 'landlord') {
          throw new HttpException(
            'Only the tenant on this request (or the landlord, force-confirming) can confirm it',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      case `${MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION}->${MaintenanceRequestStatusEnum.DENIED_BY_TENANT}`:
        if (actorRole !== 'tenant') {
          throw new HttpException(
            'Only the tenant on this request can deny it',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

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
    if (
      status === MaintenanceRequestStatusEnum.APPROVED ||
      status === MaintenanceRequestStatusEnum.REOPENED
    ) {
      request.approved_at = new Date();
    }

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
    manager?: EntityManager,
  ): Promise<MaintenanceRequestStatusHistory> {
    const repo = manager
      ? manager.getRepository(MaintenanceRequestStatusHistory)
      : this.statusHistoryRepository;
    const historyEntry = repo.create({
      maintenance_request_id: maintenanceRequestId,
      previous_status: previousStatus,
      new_status: newStatus,
      changed_by_user_id: changedByUserId,
      changed_by_role: changedByRole,
      change_reason: changeReason,
      notes: notes,
      changed_at: new Date(),
    });

    return await repo.save(historyEntry);
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

    // Block reassignment on terminal and pre-approval-tenant-confirmation
    // requests. The endpoint would otherwise mutate `assigned_to` and fire a
    // WhatsApp notification for work that's already done (or not yet eligible
    // for assignment) — see the frontend gate in
    // MaintenanceRequestDetailModal. Pairing both sides closes the devtools /
    // direct-API bypass.
    const ASSIGNMENT_LOCKED_STATUSES: MaintenanceRequestStatusEnum[] = [
      MaintenanceRequestStatusEnum.CLOSED,
      MaintenanceRequestStatusEnum.REJECTED,
      MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
      MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
    ];
    if (ASSIGNMENT_LOCKED_STATUSES.includes(sr.status)) {
      throw new HttpException(
        `Cannot reassign a request in status "${sr.status}"`,
        HttpStatus.CONFLICT,
      );
    }

    let newAssigneeTm: TeamMember | null = null;
    if (teamMemberId) {
      newAssigneeTm = await this.teamMemberRepository.findOne({
        where: { id: teamMemberId },
        relations: ['team', 'account', 'account.user'],
      });
      if (!newAssigneeTm) {
        throw new HttpException(
          'Facility manager not found',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (newAssigneeTm.team?.creatorId !== landlordAccountId) {
        throw new HttpException(
          'Assignee must be a facility manager on your team',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (newAssigneeTm.role !== RolesEnum.FACILITY_MANAGER) {
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

    const previousAssigneeTm = previousAssignee
      ? await this.teamMemberRepository.findOne({
          where: { id: previousAssignee },
          relations: ['account', 'account.user'],
        })
      : null;

    await this.maintenanceRequestRepository.update(requestId, {
      assigned_to: teamMemberId as any,
    });

    // Record the change in status-history. This is not a status transition —
    // we keep prev_status === new_status and lean on `change_reason` for the
    // audit-trail rendering. Names beat raw UUIDs so the activity log stays
    // human-readable.
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);
    await this.createStatusHistoryEntry(
      requestId,
      sr.status,
      sr.status,
      landlordUserId,
      'landlord',
      `assignee_changed: ${this.formatTeamMemberLabel(previousAssigneeTm)} → ${this.formatTeamMemberLabel(newAssigneeTm)}`,
    );

    try {
      this.eventEmitter.emit('maintenance.assigned', {
        maintenance_request_id: requestId,
        request_id: sr.request_id,
        previous_assignee: previousAssignee,
        previous_assignee_name: this.formatTeamMemberLabel(previousAssigneeTm),
        new_assignee: teamMemberId,
        new_assignee_name: this.formatTeamMemberLabel(newAssigneeTm),
        landlord_id: landlordAccountId,
        property_id: sr.property_id,
        common_area_id: sr.common_area_id,
        description: sr.description,
        tenant_id: sr.tenant_id,
        created_at: new Date(),
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
   * Landlord toggles the priority flag on one of their maintenance requests.
   * No status_history row — priority is metadata, not a transition.
   */
  async setPriority(
    requestId: string,
    isPriority: boolean,
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

    if (sr.is_priority === isPriority) {
      return sr;
    }

    await this.maintenanceRequestRepository.update(requestId, {
      is_priority: isPriority,
    });

    // Push to open clients so the Priority pill appears/disappears live.
    // We use a dedicated event (not `maintenance.updated`) because priority
    // is metadata — we don't want the notifications listener to write a
    // status-change notification row, or the history listener to write a
    // misleading property_history entry. Only the websocket bridge listens
    // to this event.
    this.eventEmitter.emit('maintenance.priority_changed', {
      request_id: requestId,
      is_priority: isPriority,
      property_id: sr.property_id,
      common_area_id: sr.common_area_id,
      landlord_id:
        sr.property?.owner_id ?? sr.common_area?.owner_id ?? null,
      tenant_name: sr.tenant_name,
      property_name: sr.property_name,
      description: sr.description,
      status: sr.status,
    });

    return this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    }) as Promise<MaintenanceRequest>;
  }

  /**
   * Tenant confirms an FM-filed maintenance request via dashboard or WhatsApp.
   * Auth: caller's Account.id must match sr.tenant_id. Status must be
   * PENDING_TENANT_CONFIRMATION — anything else 409s so a stale-tap from
   * WhatsApp can render `staleTapReply`-style copy.
   *
   * Transitions PENDING_TENANT_CONFIRMATION → NOT_APPROVED so the existing
   * landlord approve/reject + FM-picker flow takes over.
   */
  async confirmTenantMaintenanceRequest(
    requestId: string,
    tenantAccountId: string,
    source: 'dashboard' | 'whatsapp' = 'dashboard',
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }
    if (sr.tenant_id !== tenantAccountId) {
      throw new HttpException(
        'You cannot act on this request',
        HttpStatus.FORBIDDEN,
      );
    }
    if (sr.status !== MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION) {
      throw new HttpException(
        `Request is no longer awaiting your confirmation (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const tenantUserId = sr.tenant?.user?.id;
    if (!tenantUserId) {
      throw new HttpException(
        'Could not resolve tenant user for audit log',
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.NOT_APPROVED,
        tenantUserId,
        'tenant',
        `Tenant confirmed via ${source === 'whatsapp' ? 'WhatsApp' : 'Dashboard'}`,
        undefined,
        manager,
      );
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.tenant_confirmed', {
          request_id: updated.id,
          maintenance_request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_id: updated.tenant_id,
          tenant_name: updated.tenant_name,
          property_id: updated.property_id,
          property_name: updated.property_name,
          common_area_id: updated.common_area_id,
          landlord_id:
            updated.property?.owner_id ?? updated.common_area?.owner_id ?? null,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          updated_at: new Date(),
          forced_by_landlord: false,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.tenant_confirmed:',
          error,
        );
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Tenant denies an FM-filed maintenance request. Optional reason is
   * captured in the existing `rejection_reason` column (re-used). Terminal:
   * the request lands in DENIED_BY_TENANT and stays there for audit.
   */
  async denyTenantMaintenanceRequest(
    requestId: string,
    tenantAccountId: string,
    reason: string | null,
    source: 'dashboard' | 'whatsapp' = 'dashboard',
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }
    if (sr.tenant_id !== tenantAccountId) {
      throw new HttpException(
        'You cannot act on this request',
        HttpStatus.FORBIDDEN,
      );
    }
    if (sr.status !== MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION) {
      throw new HttpException(
        `Request is no longer awaiting your confirmation (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const tenantUserId = sr.tenant?.user?.id;
    if (!tenantUserId) {
      throw new HttpException(
        'Could not resolve tenant user for audit log',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const trimmedReason = reason?.trim() || null;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
        rejection_reason: trimmedReason,
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
        tenantUserId,
        'tenant',
        `Tenant denied via ${source === 'whatsapp' ? 'WhatsApp' : 'Dashboard'}`,
        trimmedReason ?? undefined,
        manager,
      );
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.tenant_denied', {
          request_id: updated.id,
          maintenance_request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_id: updated.tenant_id,
          tenant_name: updated.tenant_name,
          property_id: updated.property_id,
          property_name: updated.property_name,
          common_area_id: updated.common_area_id,
          landlord_id:
            updated.property?.owner_id ?? updated.common_area?.owner_id ?? null,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          denial_reason: trimmedReason,
          updated_at: new Date(),
        });
      } catch (error) {
        this.logger.error('Failed to emit maintenance.tenant_denied:', error);
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Patch the rejection_reason on an already-denied MR. Used by the tenant
   * WhatsApp flow: the deny *tap* commits the denial immediately (no reason);
   * if the tenant follows up with a reason within the 5-min window, this
   * method just amends the existing row. Does NOT re-emit a landlord WA ping —
   * the landlord already got the denial notification on the original deny;
   * the reason surfaces in the dashboard activity feed.
   */
  async updateTenantDenialReason(
    requestId: string,
    tenantAccountId: string,
    reason: string,
  ): Promise<MaintenanceRequest> {
    const trimmed = reason.trim();
    if (!trimmed) {
      // Treat empty as a no-op rather than wiping a real reason in case
      // multiple replies race.
      const sr = await this.maintenanceRequestRepository.findOne({
        where: { id: requestId },
      });
      if (!sr) throw new NotFoundException('Maintenance request not found');
      return sr;
    }

    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }
    if (sr.tenant_id !== tenantAccountId) {
      throw new HttpException(
        'You cannot act on this request',
        HttpStatus.FORBIDDEN,
      );
    }
    if (sr.status !== MaintenanceRequestStatusEnum.DENIED_BY_TENANT) {
      throw new HttpException(
        `Reason can only be added to a denied request (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    await this.maintenanceRequestRepository.update(requestId, {
      rejection_reason: trimmed,
    });

    return (await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
    })) as MaintenanceRequest;
  }

  /**
   * Landlord force-advances an MR stuck in PENDING_TENANT_CONFIRMATION
   * because the tenant has no phone / isn't responding. Same destination as
   * a tenant confirm (NOT_APPROVED), but the audit trail records that the
   * landlord made the call, and the listener skips re-pinging the landlord
   * via WhatsApp (they're already the one acting).
   */
  async landlordForceConfirmMaintenanceRequest(
    requestId: string,
    landlordAccountId: string,
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }

    const ownerAccountId = sr.property?.owner_id ?? null;
    if (!ownerAccountId || ownerAccountId !== landlordAccountId) {
      // Common-area MRs never enter PENDING_TENANT_CONFIRMATION, so we only
      // need the property-owner branch here.
      throw new HttpException(
        'You do not own this request',
        HttpStatus.FORBIDDEN,
      );
    }

    if (sr.status !== MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION) {
      throw new HttpException(
        `Request is no longer awaiting tenant confirmation (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.NOT_APPROVED,
        landlordUserId,
        'landlord',
        'Landlord force-confirmed (tenant unresponsive)',
        undefined,
        manager,
      );
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.tenant_confirmed', {
          request_id: updated.id,
          maintenance_request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_id: updated.tenant_id,
          tenant_name: updated.tenant_name,
          property_id: updated.property_id,
          property_name: updated.property_name,
          common_area_id: updated.common_area_id,
          landlord_id: landlordAccountId,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          updated_at: new Date(),
          forced_by_landlord: true,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.tenant_confirmed (force):',
          error,
        );
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Landlord rejects a maintenance request from WhatsApp. Only allowed from
   * NOT_APPROVED — anything already approved/assigned/closed has to take the
   * web-app path. Writes a status-history row and emits maintenance.updated
   * so the in-app notification listener fires.
   */
  async rejectMaintenanceRequest(
    requestId: string,
    landlordAccountId: string,
    reason?: string | null,
    source: 'dashboard' | 'whatsapp' = 'whatsapp',
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

    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      throw new HttpException(
        `Request is no longer pending approval (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);
    const trimmedReason = reason?.trim() || null;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.REJECTED,
        rejection_reason: trimmedReason,
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.REJECTED,
        landlordUserId,
        'landlord',
        `Landlord rejected via ${source === 'whatsapp' ? 'WhatsApp' : 'Dashboard'}`,
        trimmedReason ?? undefined,
        manager,
      );
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.updated', {
          request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_name: updated.tenant_name,
          property_name: updated.property_name,
          property_id: updated.property_id,
          common_area_id: updated.common_area_id,
          common_area_name: updated.common_area?.name ?? null,
          landlord_id:
            updated.property?.owner_id ?? updated.common_area?.owner_id ?? null,
          tenant_id: updated.tenant_id,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          updated_at: new Date(),
          actor: { id: landlordUserId, role: 'landlord' },
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.updated after reject:',
          error,
        );
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Landlord approves a maintenance request AND assigns an FM in a single
   * transaction — the WhatsApp Approve flow couples the two because the
   * FM "View all requests" surface hides NOT_APPROVED, so an assign
   * without an approve would silently strand the request.
   *
   * Source status must be NOT_APPROVED (409 otherwise). Emits both
   * `maintenance.updated` (status flip) and `maintenance.assigned`
   * (assignee change → fans out fm_assignment_notification to the whole
   * team). Sets `skip_approval_ping: true` on the updated event so the
   * listener doesn't ALSO send fm_maintenance_request_approved to the
   * assignee — the assignment notification already covers them.
   */
  async approveAndAssignMaintenanceRequest(
    requestId: string,
    teamMemberId: string,
    landlordAccountId: string,
    source: 'dashboard' | 'whatsapp' = 'dashboard',
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

    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      throw new HttpException(
        `Request is no longer pending approval (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const tm = await this.teamMemberRepository.findOne({
      where: { id: teamMemberId },
      relations: ['team', 'account', 'account.user'],
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

    const fmUser = tm.account?.user;
    const fmName = fmUser
      ? `${fmUser.first_name ?? ''} ${fmUser.last_name ?? ''}`.trim() ||
        tm.email ||
        'Facility Manager'
      : tm.email || 'Facility Manager';

    const previousStatus = sr.status;
    const previousAssignee = sr.assigned_to ?? null;
    const previousAssigneeTm = previousAssignee
      ? await this.teamMemberRepository.findOne({
          where: { id: previousAssignee },
          relations: ['account', 'account.user'],
        })
      : null;
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.APPROVED,
        assigned_to: teamMemberId as any,
        approved_at: new Date(),
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.APPROVED,
        landlordUserId,
        'landlord',
        `Landlord approved & assigned to ${fmName} via ${source === 'whatsapp' ? 'WhatsApp' : 'dashboard'}`,
        undefined,
        manager,
      );
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.updated', {
          request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_name: updated.tenant_name,
          property_name: updated.property_name,
          property_id: updated.property_id,
          common_area_id: updated.common_area_id,
          common_area_name: updated.common_area?.name ?? null,
          landlord_id: landlordAccountId,
          tenant_id: updated.tenant_id,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          assigned_to_name: fmName,
          updated_at: new Date(),
          actor: { id: landlordUserId, role: 'landlord' },
          // Suppress the FM "request approved" template — the assignment
          // fan-out below already covers the assignee.
          skip_approval_ping: true,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.updated after approve+assign:',
          error,
        );
      }

      try {
        this.eventEmitter.emit('maintenance.assigned', {
          maintenance_request_id: requestId,
          request_id: updated.request_id,
          previous_assignee: previousAssignee,
          previous_assignee_name:
            this.formatTeamMemberLabel(previousAssigneeTm),
          new_assignee: teamMemberId,
          new_assignee_name: fmName,
          landlord_id: landlordAccountId,
          property_id: updated.property_id,
          common_area_id: updated.common_area_id,
          description: updated.description,
          tenant_id: updated.tenant_id,
          created_at: new Date(),
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.assigned after approve+assign:',
          error,
        );
      }
    }

    return updated as MaintenanceRequest;
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
